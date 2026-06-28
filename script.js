const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};

const display = $('#display');
const progress = $('#progress');
const minutesInput = $('#minutes');
const secondsInput = $('#seconds');
const workSecondsInput = $('#workSeconds');
const restSecondsInput = $('#restSeconds');
const roundsInput = $('#rounds');
const lapsEl = $('#laps');
const historyEl = $('#history');
const statusEl = $('#status');
const phaseCard = $('#phaseCard');
const soundEl = $('#sound');
const volumeEl = $('#volume');
const startBtn = $('#startBtn');
const pauseBtn = $('#pauseBtn');
const lapBtn = $('#lapBtn');
const presetForm = $('#presetForm');
const customPresetsEl = $('#customPresets');

const radius = 94;
const circumference = 2 * Math.PI * radius;
progress.style.strokeDasharray = `${circumference}`;

const defaultSettings = {
  mode: 'countdown',
  theme: 'dark',
  sound: true,
  volume: 0.25,
  minutes: 25,
  seconds: 0,
  workSeconds: 40,
  restSeconds: 20,
  rounds: 8,
  customPresets: [],
  history: []
};

const settings = { ...defaultSettings, ...store.get('ultimateTimerSettings', {}) };
let mode = settings.mode;
let running = false;
let total = 1500;
let remaining = 1500;
let elapsed = 0;
let laps = [];
let rafId = null;
let startedAt = 0;
let baseRemaining = 0;
let baseElapsed = 0;
let intervalState = { phase: 'work', round: 1, phaseRemaining: settings.workSeconds };
let pomodoroState = { phase: 'focus', session: 1 };

function persist() {
  store.set('ultimateTimerSettings', {
    ...settings,
    mode,
    sound: soundEl.checked,
    volume: Number(volumeEl.value),
    minutes: clampNumber(minutesInput.value, 0, 600),
    seconds: clampNumber(secondsInput.value, 0, 59),
    workSeconds: clampNumber(workSecondsInput.value, 1, 3600),
    restSeconds: clampNumber(restSecondsInput.value, 0, 3600),
    rounds: clampNumber(roundsInput.value, 1, 99)
  });
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function formatTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

function applySettings() {
  document.body.classList.toggle('light', settings.theme === 'light');
  minutesInput.value = settings.minutes;
  secondsInput.value = settings.seconds;
  workSecondsInput.value = settings.workSeconds;
  restSecondsInput.value = settings.restSeconds;
  roundsInput.value = settings.rounds;
  soundEl.checked = settings.sound;
  volumeEl.value = settings.volume;
  renderCustomPresets();
  renderHistory();
  setMode(mode, false);
}

function getCountdownTotal() {
  return Math.max(1, clampNumber(minutesInput.value, 0, 600) * 60 + clampNumber(secondsInput.value, 0, 59));
}

function getIntervalPhaseTotal() {
  return intervalState.phase === 'work'
    ? clampNumber(workSecondsInput.value, 1, 3600)
    : Math.max(1, clampNumber(restSecondsInput.value, 0, 3600));
}

function getCurrentTime() {
  if (mode === 'stopwatch') return elapsed;
  if (mode === 'interval') return intervalState.phaseRemaining;
  return remaining;
}

function getProgressRatio() {
  if (mode === 'stopwatch') return Math.min(1, (elapsed % 60) / 60);
  if (mode === 'interval') return getIntervalPhaseTotal() ? intervalState.phaseRemaining / getIntervalPhaseTotal() : 0;
  return total ? remaining / total : 0;
}

function modeLabel() {
  return { countdown: 'Таймер', stopwatch: 'Секундомер', pomodoro: 'Pomodoro', interval: 'Интервалы' }[mode];
}

function render() {
  display.textContent = formatTime(getCurrentTime());
  progress.style.strokeDashoffset = `${circumference * (1 - getProgressRatio())}`;
  const phaseText = getPhaseText();
  phaseCard.textContent = phaseText;
  statusEl.textContent = `Режим: ${modeLabel()}${running ? ' • работает' : ''}`;
  startBtn.textContent = running ? 'Идёт…' : 'Старт';
  startBtn.disabled = running;
  pauseBtn.disabled = !running;
  lapBtn.disabled = mode === 'countdown' && !running;
}

function getPhaseText() {
  if (mode === 'pomodoro') {
    const labels = { focus: 'Фокус', short: 'Короткий перерыв', long: 'Длинный перерыв' };
    return `${labels[pomodoroState.phase]} • сессия ${pomodoroState.session}/4`;
  }
  if (mode === 'interval') {
    return `${intervalState.phase === 'work' ? 'Работа' : 'Отдых'} • раунд ${intervalState.round}/${clampNumber(roundsInput.value, 1, 99)}`;
  }
  if (mode === 'stopwatch') return laps.length ? `Кругов: ${laps.length}` : 'Секундомер готов';
  return remaining === 0 ? 'Время вышло' : 'Готов к запуску';
}

function notify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'icons/icon.svg' });
  }
}

function beep(repeats = 1) {
  if (!soundEl.checked) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const volume = Number(volumeEl.value);
  for (let i = 0; i < repeats; i += 1) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = i % 2 ? 660 : 880;
    gain.gain.setValueAtTime(volume, ctx.currentTime + i * 0.22);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.18);
    osc.start(ctx.currentTime + i * 0.22);
    osc.stop(ctx.currentTime + i * 0.22 + 0.2);
  }
  if ('vibrate' in navigator) navigator.vibrate([120, 70, 120]);
}

function start() {
  if (running) return;
  if ((mode === 'countdown' || mode === 'pomodoro') && remaining <= 0) reset();
  if (mode === 'interval' && intervalState.phaseRemaining <= 0) reset();
  running = true;
  startedAt = performance.now();
  baseRemaining = remaining;
  baseElapsed = elapsed;
  rafId = requestAnimationFrame(updateClock);
  render();
}

function pause() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(rafId);
  render();
}

function updateClock(now) {
  if (!running) return;
  const diff = (now - startedAt) / 1000;
  if (mode === 'stopwatch') {
    elapsed = baseElapsed + diff;
  } else if (mode === 'interval') {
    intervalState.phaseRemaining = baseRemaining - diff;
    if (intervalState.phaseRemaining <= 0) advanceInterval();
  } else {
    remaining = baseRemaining - diff;
    if (remaining <= 0) finishCountdownLikeMode();
  }
  render();
  rafId = requestAnimationFrame(updateClock);
}

function finishCountdownLikeMode() {
  remaining = 0;
  running = false;
  cancelAnimationFrame(rafId);
  beep(3);
  if (mode === 'pomodoro') {
    addHistory(`Pomodoro: ${getPhaseText()}`);
    advancePomodoro();
    notify('Pomodoro завершён', getPhaseText());
  } else {
    addHistory(`Таймер: ${formatTime(total)}`);
    notify('Таймер завершён', 'Заданное время истекло.');
  }
}

function advancePomodoro() {
  if (pomodoroState.phase === 'focus') {
    pomodoroState.phase = pomodoroState.session >= 4 ? 'long' : 'short';
    total = pomodoroState.phase === 'long' ? 15 * 60 : 5 * 60;
  } else {
    if (pomodoroState.phase === 'long') pomodoroState.session = 1;
    else pomodoroState.session += 1;
    pomodoroState.phase = 'focus';
    total = getCountdownTotal();
  }
  remaining = total;
}

function advanceInterval() {
  beep(1);
  const rounds = clampNumber(roundsInput.value, 1, 99);
  const rest = clampNumber(restSecondsInput.value, 0, 3600);
  if (intervalState.phase === 'work' && rest > 0) {
    intervalState.phase = 'rest';
    intervalState.phaseRemaining = rest;
  } else if (intervalState.round < rounds) {
    intervalState.round += 1;
    intervalState.phase = 'work';
    intervalState.phaseRemaining = clampNumber(workSecondsInput.value, 1, 3600);
  } else {
    running = false;
    cancelAnimationFrame(rafId);
    intervalState.phaseRemaining = 0;
    addHistory(`Интервалы: ${rounds} раундов`);
    notify('Интервальная тренировка завершена', `${rounds} раундов выполнено.`);
    beep(3);
    return;
  }
  startedAt = performance.now();
  baseRemaining = intervalState.phaseRemaining;
  notify('Новый интервал', getPhaseText());
}

function reset() {
  pause();
  if (mode === 'stopwatch') {
    elapsed = 0;
  } else if (mode === 'interval') {
    intervalState = { phase: 'work', round: 1, phaseRemaining: clampNumber(workSecondsInput.value, 1, 3600) };
    remaining = intervalState.phaseRemaining;
  } else {
    total = getCountdownTotal();
    remaining = total;
    if (mode === 'pomodoro') pomodoroState = { phase: 'focus', session: 1 };
  }
  laps = [];
  lapsEl.innerHTML = '';
  persist();
  render();
}

function addLap() {
  const t = getCurrentTime();
  laps.unshift(t);
  lapsEl.innerHTML = laps.map((sec, i) => `<div class="lap"><span>Круг ${laps.length - i}</span><strong>${formatTime(sec)}</strong></div>`).join('');
}

function addHistory(label) {
  settings.history = [{ label, at: new Date().toLocaleString('ru-RU') }, ...settings.history].slice(0, 8);
  persist();
  renderHistory();
}

function renderHistory() {
  historyEl.innerHTML = settings.history?.length
    ? settings.history.map((item) => `<div class="history-item"><span>${item.label}</span><time>${item.at}</time></div>`).join('')
    : '<div class="stat">История завершённых сессий появится здесь.</div>';
}

function renderCustomPresets() {
  customPresetsEl.innerHTML = settings.customPresets.map((preset, index) => `
    <span class="preset-chip"><button class="pill" data-custom-preset="${preset.seconds}" type="button">${preset.name}</button><button class="delete-preset" data-delete-preset="${index}" aria-label="Удалить ${preset.name}" type="button">×</button></span>
  `).join('');
}

function setMode(nextMode, shouldReset = true) {
  mode = nextMode;
  $$('[data-mode]').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  $$('.mode-panel').forEach((panel) => panel.classList.toggle('hidden', !panel.dataset.panel.split(' ').includes(mode)));
  presetForm.classList.toggle('hidden', mode === 'stopwatch' || mode === 'interval');
  customPresetsEl.classList.toggle('hidden', mode === 'stopwatch' || mode === 'interval');
  if (shouldReset) reset();
  persist();
  render();
}

$$('[data-mode]').forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

$$('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => applyPreset(Number(btn.dataset.preset)));
});

function applyPreset(sec) {
  minutesInput.value = Math.floor(sec / 60);
  secondsInput.value = sec % 60;
  setMode(mode === 'pomodoro' ? 'pomodoro' : 'countdown');
}

customPresetsEl.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-preset]');
  if (deleteButton) {
    settings.customPresets.splice(Number(deleteButton.dataset.deletePreset), 1);
    persist();
    renderCustomPresets();
    return;
  }
  const presetButton = event.target.closest('[data-custom-preset]');
  if (presetButton) applyPreset(Number(presetButton.dataset.customPreset));
});

presetForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#presetName').value.trim() || 'Пресет';
  const minutes = clampNumber($('#presetMinutes').value, 1, 600);
  settings.customPresets.push({ name, seconds: minutes * 60 });
  $('#presetName').value = '';
  $('#presetMinutes').value = '';
  persist();
  renderCustomPresets();
});

$('#themeBtn').addEventListener('click', () => {
  settings.theme = document.body.classList.toggle('light') ? 'light' : 'dark';
  persist();
});

$('#notifyBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  await Notification.requestPermission();
});

startBtn.addEventListener('click', start);
$('#pauseBtn').addEventListener('click', pause);
$('#resetBtn').addEventListener('click', reset);
lapBtn.addEventListener('click', addLap);
[minutesInput, secondsInput, workSecondsInput, restSecondsInput, roundsInput, soundEl, volumeEl].forEach((input) => {
  input.addEventListener('change', reset);
});

document.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); running ? pause() : start(); }
  if (event.key.toLowerCase() === 'r') reset();
  if (event.key.toLowerCase() === 'l') addLap();
  if (event.key.toLowerCase() === 't') $('#themeBtn').click();
  if (/^[1-4]$/.test(event.key)) $$('[data-preset]')[Number(event.key) - 1]?.click();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

applySettings();
