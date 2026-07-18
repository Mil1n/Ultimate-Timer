import { beep, notify, speak } from './audio.js';
import { applyServiceWorkerUpdate, registerServiceWorker } from './pwa.js';
import { downloadJson, readJsonFile, readStore, RUNTIME_KEY, SETTINGS_KEY, writeStore } from './storage.js';
import { buildStats, clampNumber, formatTime, getModeFromHash, getNextPomodoroState } from './timer-utils.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const display = $('#display');
const progress = $('#progress');
const minutesInput = $('#minutes');
const secondsInput = $('#seconds');
const shortBreakInput = $('#shortBreakMinutes');
const longBreakInput = $('#longBreakMinutes');
const sessionsBeforeLongBreakInput = $('#sessionsBeforeLongBreak');
const autoStartPomodoroEl = $('#autoStartPomodoro');
const autoStartIntervalEl = $('#autoStartInterval');
const warmupSecondsInput = $('#warmupSeconds');
const workSecondsInput = $('#workSeconds');
const restSecondsInput = $('#restSeconds');
const cooldownSecondsInput = $('#cooldownSeconds');
const roundsInput = $('#rounds');
const lapsEl = $('#laps');
const historyEl = $('#history');
const statsEl = $('#stats');
const statusEl = $('#status');
const phaseCard = $('#phaseCard');
const cycleProgress = $('#cycleProgress');
const soundEl = $('#sound');
const soundTypeEl = $('#soundType');
const voiceEl = $('#voice');
const wakeLockEl = $('#wakeLock');
const volumeEl = $('#volume');
const startBtn = $('#startBtn');
const pauseBtn = $('#pauseBtn');
const lapBtn = $('#lapBtn');
const presetForm = $('#presetForm');
const customPresetsEl = $('#customPresets');
const importFileEl = $('#importFile');

const radius = 94;
const circumference = 2 * Math.PI * radius;
progress.style.strokeDasharray = `${circumference}`;

const defaultSettings = {
  mode: 'countdown',
  theme: 'dark',
  sound: true,
  soundType: 'classic',
  voice: false,
  wakeLock: false,
  volume: 0.25,
  minutes: 25,
  seconds: 0,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartPomodoro: false,
  autoStartInterval: true,
  warmupSeconds: 0,
  workSeconds: 40,
  restSeconds: 20,
  cooldownSeconds: 0,
  rounds: 8,
  customPresets: [],
  history: []
};

let settings = { ...defaultSettings, ...readStore(SETTINGS_KEY, {}) };
let runtime = readStore(RUNTIME_KEY, null);
let mode = getModeFromHash(location.hash, settings.mode);
let running = false;
let total = 1500;
let remaining = 1500;
let elapsed = 0;
let laps = [];
let rafId = null;
let startedAt = 0;
let baseRemaining = 0;
let baseElapsed = 0;
let lastRuntimePersistedAt = 0;
let intervalState = { phase: 'work', round: 1, phaseRemaining: settings.workSeconds };
let pomodoroState = { phase: 'focus', session: 1 };
let wakeLock = null;

function collectSettings() {
  return {
    ...settings,
    mode,
    sound: soundEl.checked,
    soundType: soundTypeEl.value,
    voice: voiceEl.checked,
    wakeLock: wakeLockEl.checked,
    volume: Number(volumeEl.value),
    minutes: clampNumber(minutesInput.value, 0, 600),
    seconds: clampNumber(secondsInput.value, 0, 59),
    shortBreakMinutes: clampNumber(shortBreakInput.value, 1, 120),
    longBreakMinutes: clampNumber(longBreakInput.value, 1, 240),
    sessionsBeforeLongBreak: clampNumber(sessionsBeforeLongBreakInput.value, 1, 12),
    autoStartPomodoro: autoStartPomodoroEl.checked,
    autoStartInterval: autoStartIntervalEl.checked,
    warmupSeconds: clampNumber(warmupSecondsInput.value, 0, 3600),
    workSeconds: clampNumber(workSecondsInput.value, 1, 3600),
    restSeconds: clampNumber(restSecondsInput.value, 0, 3600),
    cooldownSeconds: clampNumber(cooldownSecondsInput.value, 0, 3600),
    rounds: clampNumber(roundsInput.value, 1, 99)
  };
}

function persist() {
  settings = collectSettings();
  writeStore(SETTINGS_KEY, settings);
}

function buildRuntimeSnapshot() {
  return {
    mode,
    running,
    total,
    remaining,
    elapsed,
    laps,
    intervalState,
    pomodoroState,
    savedAt: Date.now(),
    targetAt: running && mode !== 'stopwatch' ? Date.now() + remaining * 1000 : null,
    startedAtEpoch: running && mode === 'stopwatch' ? Date.now() - elapsed * 1000 : null
  };
}

function persistRuntime({ force = false } = {}) {
  const now = Date.now();
  if (!force && running && now - lastRuntimePersistedAt < 5000) return;
  lastRuntimePersistedAt = now;
  writeStore(RUNTIME_KEY, buildRuntimeSnapshot());
}

function pomodoroConfig() {
  return {
    focusSeconds: getCountdownTotal(),
    shortBreakMinutes: clampNumber(shortBreakInput.value, 1, 120),
    longBreakMinutes: clampNumber(longBreakInput.value, 1, 240),
    sessionsBeforeLongBreak: clampNumber(sessionsBeforeLongBreakInput.value, 1, 12)
  };
}

function getCountdownTotal() {
  return Math.max(1, clampNumber(minutesInput.value, 0, 600) * 60 + clampNumber(secondsInput.value, 0, 59));
}

function getIntervalPhaseTotal() {
  const phaseTotals = {
    warmup: clampNumber(warmupSecondsInput.value, 0, 3600),
    work: clampNumber(workSecondsInput.value, 1, 3600),
    rest: Math.max(1, clampNumber(restSecondsInput.value, 0, 3600)),
    cooldown: Math.max(1, clampNumber(cooldownSecondsInput.value, 0, 3600))
  };
  return phaseTotals[intervalState.phase] || 1;
}

function getCurrentTime() {
  if (mode === 'stopwatch') return elapsed;
  if (mode === 'interval') return intervalState.phaseRemaining;
  return remaining;
}

function getProgressRatio() {
  if (mode === 'stopwatch') return Math.min(1, (elapsed % 60) / 60);
  if (mode === 'interval') return intervalState.phaseRemaining / getIntervalPhaseTotal();
  return remaining / total;
}

function modeLabel() {
  return { countdown: 'Таймер', stopwatch: 'Секундомер', pomodoro: 'Pomodoro', interval: 'Интервалы' }[mode];
}

function setPhaseClass() {
  document.body.dataset.phase = mode === 'interval' ? intervalState.phase : mode === 'pomodoro' ? pomodoroState.phase : mode;
}

function getPhaseText() {
  if (mode === 'pomodoro') {
    const labels = { focus: 'Фокус', short: 'Короткий перерыв', long: 'Длинный перерыв' };
    return `${labels[pomodoroState.phase]} • сессия ${pomodoroState.session}/${clampNumber(sessionsBeforeLongBreakInput.value, 1, 12)}`;
  }
  if (mode === 'interval') {
    const labels = { warmup: 'Разминка', work: 'Работа', rest: 'Отдых', cooldown: 'Заминка' };
    return `${labels[intervalState.phase]} • раунд ${intervalState.round}/${clampNumber(roundsInput.value, 1, 99)}`;
  }
  if (mode === 'stopwatch') return laps.length ? `Кругов: ${laps.length}` : 'Секундомер готов';
  return remaining === 0 ? 'Время вышло' : 'Готов к запуску';
}

function render() {
  setPhaseClass();
  display.textContent = formatTime(getCurrentTime());
  progress.style.strokeDashoffset = `${circumference * (1 - Math.max(0, Math.min(1, getProgressRatio())))}`;
  phaseCard.textContent = getPhaseText();
  cycleProgress.textContent = mode === 'pomodoro'
    ? `Цикл: ${pomodoroState.session}/${clampNumber(sessionsBeforeLongBreakInput.value, 1, 12)}`
    : mode === 'interval' ? `Фаза: ${intervalState.phase}` : '';
  statusEl.textContent = `Режим: ${modeLabel()}${running ? ' • работает' : ''}`;
  startBtn.textContent = running ? 'Идёт…' : 'Старт';
  startBtn.disabled = running;
  pauseBtn.disabled = !running;
  lapBtn.disabled = mode === 'countdown' && !running;
  persistRuntime();
}

function playBeep(repeats = 1) {
  beep({ enabled: soundEl.checked, type: soundTypeEl.value, volume: Number(volumeEl.value), repeats });
}

function sendNotice(title, body) {
  notify(title, body, { voice: voiceEl.checked });
}

async function updateWakeLock() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
  if (running && wakeLockEl.checked && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
  }
}

function start() {
  if (running) return;
  if ((mode === 'countdown' || mode === 'pomodoro') && remaining <= 0) reset();
  if (mode === 'interval' && intervalState.phaseRemaining <= 0) reset();
  running = true;
  startedAt = performance.now();
  baseRemaining = getCurrentTime();
  baseElapsed = elapsed;
  rafId = requestAnimationFrame(updateClock);
  updateWakeLock();
  persistRuntime({ force: true });
  render();
}

function pause() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(rafId);
  updateWakeLock();
  persistRuntime({ force: true });
  render();
}

function updateClock(now) {
  if (!running) return;
  const diff = (now - startedAt) / 1000;
  if (mode === 'stopwatch') elapsed = baseElapsed + diff;
  else if (mode === 'interval') {
    intervalState.phaseRemaining = baseRemaining - diff;
    if (intervalState.phaseRemaining <= 0) advanceInterval();
  } else {
    remaining = baseRemaining - diff;
    if (remaining <= 0) finishCountdownLikeMode();
  }
  render();
  if (running) rafId = requestAnimationFrame(updateClock);
}

function finishCountdownLikeMode() {
  remaining = 0;
  running = false;
  cancelAnimationFrame(rafId);
  playBeep(3);
  if (mode === 'pomodoro') {
    addHistory(`Pomodoro: ${getPhaseText()}`, total);
    advancePomodoro();
    sendNotice('Pomodoro завершён', getPhaseText());
    if (autoStartPomodoroEl.checked) start();
  } else {
    addHistory(`Таймер: ${formatTime(total)}`, total);
    sendNotice('Таймер завершён', 'Заданное время истекло.');
  }
  persistRuntime({ force: true });
}

function advancePomodoro() {
  const next = getNextPomodoroState(pomodoroState, pomodoroConfig());
  pomodoroState = { phase: next.phase, session: next.session };
  total = next.total;
  remaining = total;
}

function advanceInterval() {
  playBeep(1);
  const rounds = clampNumber(roundsInput.value, 1, 99);
  const rest = clampNumber(restSecondsInput.value, 0, 3600);
  const cooldown = clampNumber(cooldownSecondsInput.value, 0, 3600);
  if (intervalState.phase === 'warmup') {
    intervalState = { phase: 'work', round: 1, phaseRemaining: clampNumber(workSecondsInput.value, 1, 3600) };
  } else if (intervalState.phase === 'work' && rest > 0) {
    intervalState = { ...intervalState, phase: 'rest', phaseRemaining: rest };
  } else if (intervalState.round < rounds) {
    intervalState = { phase: 'work', round: intervalState.round + 1, phaseRemaining: clampNumber(workSecondsInput.value, 1, 3600) };
  } else if (cooldown > 0 && intervalState.phase !== 'cooldown') {
    intervalState = { phase: 'cooldown', round: rounds, phaseRemaining: cooldown };
  } else {
    running = false;
    cancelAnimationFrame(rafId);
    intervalState.phaseRemaining = 0;
    addHistory(`Интервалы: ${rounds} раундов`, rounds * clampNumber(workSecondsInput.value, 1, 3600));
    sendNotice('Интервальная тренировка завершена', `${rounds} раундов выполнено.`);
    playBeep(3);
    persistRuntime({ force: true });
    return;
  }
  startedAt = performance.now();
  baseRemaining = intervalState.phaseRemaining;
  sendNotice('Новый интервал', getPhaseText());
  persistRuntime({ force: true });
  if (!autoStartIntervalEl.checked) pause();
}

function reset() {
  if (running) pause();
  if (mode === 'stopwatch') elapsed = 0;
  else if (mode === 'interval') {
    const warmup = clampNumber(warmupSecondsInput.value, 0, 3600);
    intervalState = {
      phase: warmup > 0 ? 'warmup' : 'work',
      round: 1,
      phaseRemaining: warmup > 0 ? warmup : clampNumber(workSecondsInput.value, 1, 3600)
    };
    remaining = intervalState.phaseRemaining;
  } else {
    total = getCountdownTotal();
    remaining = total;
    if (mode === 'pomodoro') pomodoroState = { phase: 'focus', session: 1 };
  }
  laps = [];
  lapsEl.replaceChildren();
  persist();
  persistRuntime({ force: true });
  render();
}

function addLap() {
  const row = document.createElement('div');
  row.className = 'lap';
  const name = document.createElement('span');
  const value = document.createElement('strong');
  laps.unshift(getCurrentTime());
  name.textContent = `Круг ${laps.length}`;
  value.textContent = formatTime(laps[0]);
  row.append(name, value);
  lapsEl.prepend(row);
  persistRuntime({ force: true });
  render();
}

function addHistory(label, duration = 0) {
  settings.history = [{ label, duration, mode, at: new Date().toLocaleString('ru-RU'), day: new Date().toISOString().slice(0, 10) }, ...settings.history].slice(0, 200);
  persist();
  renderHistory();
  renderStats();
}

function renderHistory() {
  historyEl.replaceChildren();
  if (!settings.history?.length) {
    const empty = document.createElement('div');
    empty.className = 'stat';
    empty.textContent = 'История завершённых сессий появится здесь.';
    historyEl.append(empty);
    return;
  }
  settings.history.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const label = document.createElement('span');
    const time = document.createElement('time');
    label.textContent = item.label;
    time.textContent = item.at;
    row.append(label, time);
    historyEl.append(row);
  });
}

function renderStats() {
  const stats = buildStats(settings.history || []);
  statsEl.textContent = `Сегодня: ${stats.todaySessions} сессий • фокус ${formatTime(stats.todayFocus)} • тренировки ${formatTime(stats.todayTraining)} · 7 дней: ${stats.weekSessions} сессий / ${formatTime(stats.weekFocus)} фокуса`;
}

function makePresetAction(label, title, action, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset[action] = String(index);
  button.title = title;
  button.setAttribute('aria-label', title);
  button.textContent = label;
  return button;
}

function renderCustomPresets() {
  customPresetsEl.replaceChildren();
  settings.customPresets.forEach((preset, index) => {
    const chip = document.createElement('span');
    chip.className = 'preset-chip';
    const button = document.createElement('button');
    button.className = 'pill';
    button.type = 'button';
    button.dataset.customPreset = String(preset.seconds);
    button.textContent = `${preset.name} ${formatTime(preset.seconds)}`;
    const actions = document.createElement('span');
    actions.className = 'preset-actions';
    actions.append(
      makePresetAction('↑', `Поднять ${preset.name}`, 'movePresetUp', index),
      makePresetAction('↓', `Опустить ${preset.name}`, 'movePresetDown', index),
      makePresetAction('✎', `Редактировать ${preset.name}`, 'editPreset', index),
      makePresetAction('×', `Удалить ${preset.name}`, 'deletePreset', index)
    );
    chip.append(button, actions);
    customPresetsEl.append(chip);
  });
}

function syncHash() {
  const nextHash = `#${mode}`;
  if (location.hash !== nextHash) history.replaceState(null, '', nextHash);
}

function setMode(nextMode, shouldReset = true) {
  mode = nextMode;
  $$('[data-mode]').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
  });
  $$('.mode-panel').forEach((panel) => panel.classList.toggle('hidden', !panel.dataset.panel.split(' ').includes(mode)));
  presetForm.classList.toggle('hidden', mode === 'stopwatch' || mode === 'interval');
  customPresetsEl.classList.toggle('hidden', mode === 'stopwatch' || mode === 'interval');
  syncHash();
  if (shouldReset) reset();
  persist();
  render();
}

function applyPreset(sec) {
  minutesInput.value = Math.floor(sec / 60);
  secondsInput.value = sec % 60;
  setMode(mode === 'pomodoro' ? 'pomodoro' : 'countdown');
}

function applySettingsToForm() {
  document.body.classList.toggle('light', settings.theme === 'light');
  $('#themeBtn').setAttribute('aria-pressed', String(settings.theme === 'light'));
  minutesInput.value = settings.minutes;
  secondsInput.value = settings.seconds;
  shortBreakInput.value = settings.shortBreakMinutes;
  longBreakInput.value = settings.longBreakMinutes;
  sessionsBeforeLongBreakInput.value = settings.sessionsBeforeLongBreak;
  autoStartPomodoroEl.checked = settings.autoStartPomodoro;
  autoStartIntervalEl.checked = settings.autoStartInterval;
  warmupSecondsInput.value = settings.warmupSeconds;
  workSecondsInput.value = settings.workSeconds;
  restSecondsInput.value = settings.restSeconds;
  cooldownSecondsInput.value = settings.cooldownSeconds;
  roundsInput.value = settings.rounds;
  soundEl.checked = settings.sound;
  soundTypeEl.value = settings.soundType;
  voiceEl.checked = settings.voice;
  wakeLockEl.checked = settings.wakeLock;
  volumeEl.value = settings.volume;
}

function applySettings() {
  applySettingsToForm();
  renderCustomPresets();
  renderHistory();
  renderStats();
  setMode(mode, false);
  restoreRuntime();
}

function restoreRuntime() {
  if (!runtime || runtime.mode !== mode) {
    reset();
    return;
  }
  total = runtime.total || total;
  laps = runtime.laps || [];
  pomodoroState = runtime.pomodoroState || pomodoroState;
  intervalState = runtime.intervalState || intervalState;
  if (runtime.running && mode === 'stopwatch') {
    elapsed = Math.max(0, (Date.now() - runtime.startedAtEpoch) / 1000);
  } else if (runtime.running && runtime.targetAt) {
    const left = (runtime.targetAt - Date.now()) / 1000;
    if (left <= 0) {
      remaining = 0;
      intervalState.phaseRemaining = 0;
      running = false;
      addHistory(`${modeLabel()}: завершено во время отсутствия`, runtime.total || 0);
    } else if (mode === 'interval') intervalState.phaseRemaining = left;
    else remaining = left;
  } else {
    remaining = runtime.remaining ?? remaining;
    elapsed = runtime.elapsed ?? elapsed;
  }
  if (runtime.running && getCurrentTime() > 0) start();
  else render();
}

function editPreset(index) {
  const preset = settings.customPresets[index];
  const nextName = prompt('Название пресета', preset.name)?.trim() || preset.name;
  const nextMinutes = clampNumber(prompt('Минуты', Math.floor(preset.seconds / 60)), 0, 600);
  const nextSeconds = clampNumber(prompt('Секунды', preset.seconds % 60), 0, 59);
  settings.customPresets[index] = { name: nextName, seconds: Math.max(1, nextMinutes * 60 + nextSeconds) };
  persist();
  renderCustomPresets();
}

function movePreset(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= settings.customPresets.length) return;
  const [preset] = settings.customPresets.splice(index, 1);
  settings.customPresets.splice(nextIndex, 0, preset);
  persist();
  renderCustomPresets();
}

function exportAllData() {
  persist();
  persistRuntime({ force: true });
  downloadJson('ultimate-timer-backup.json', {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings,
    runtime: buildRuntimeSnapshot()
  });
}

async function importAllData(file) {
  const data = await readJsonFile(file);
  if (!data.settings) throw new Error('Некорректный файл резервной копии');
  settings = { ...defaultSettings, ...data.settings };
  runtime = data.runtime || null;
  writeStore(SETTINGS_KEY, settings);
  if (runtime) writeStore(RUNTIME_KEY, runtime);
  mode = getModeFromHash(`#${settings.mode}`, 'countdown');
  applySettings();
}

$$('[data-mode]').forEach((btn, index, tabs) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
  btn.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    tabs[nextIndex].focus();
    setMode(tabs[nextIndex].dataset.mode);
  });
});

$$('[data-preset]').forEach((btn) => btn.addEventListener('click', () => applyPreset(Number(btn.dataset.preset))));
customPresetsEl.addEventListener('click', (event) => {
  const target = event.target;
  const deleteButton = target.closest('[data-delete-preset]');
  const editButton = target.closest('[data-edit-preset]');
  const moveUpButton = target.closest('[data-move-preset-up]');
  const moveDownButton = target.closest('[data-move-preset-down]');
  if (deleteButton) settings.customPresets.splice(Number(deleteButton.dataset.deletePreset), 1);
  else if (editButton) return editPreset(Number(editButton.dataset.editPreset));
  else if (moveUpButton) return movePreset(Number(moveUpButton.dataset.movePresetUp), -1);
  else if (moveDownButton) return movePreset(Number(moveDownButton.dataset.movePresetDown), 1);
  else {
    const preset = target.closest('[data-custom-preset]');
    if (preset) applyPreset(Number(preset.dataset.customPreset));
    return;
  }
  persist();
  renderCustomPresets();
});

presetForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const minutes = clampNumber($('#presetMinutes').value, 0, 600);
  const seconds = clampNumber($('#presetSeconds').value, 0, 59);
  const totalSeconds = Math.max(1, minutes * 60 + seconds);
  settings.customPresets.push({ name: $('#presetName').value.trim() || 'Пресет', seconds: totalSeconds });
  $('#presetName').value = '';
  $('#presetMinutes').value = '';
  $('#presetSeconds').value = '';
  persist();
  renderCustomPresets();
});

$('#themeBtn').addEventListener('click', () => {
  settings.theme = document.body.classList.toggle('light') ? 'light' : 'dark';
  $('#themeBtn').setAttribute('aria-pressed', String(settings.theme === 'light'));
  persist();
});
$('#notifyBtn').addEventListener('click', async () => { if ('Notification' in window) await Notification.requestPermission(); });
$('#testSoundBtn').addEventListener('click', () => { playBeep(2); speak('Проверка звука', voiceEl.checked); });
$('#focusBtn').addEventListener('click', async () => {
  document.body.classList.toggle('focus-mode');
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  else if (document.exitFullscreen) await document.exitFullscreen();
});
$('#clearHistoryBtn').addEventListener('click', () => {
  if (!confirm('Очистить историю завершённых сессий?')) return;
  settings.history = [];
  persist();
  renderHistory();
  renderStats();
});
$('#resetAllBtn').addEventListener('click', () => {
  if (!confirm('Сбросить все настройки, пресеты, историю и состояние таймера?')) return;
  settings = { ...defaultSettings };
  runtime = null;
  writeStore(SETTINGS_KEY, settings);
  writeStore(RUNTIME_KEY, null);
  mode = settings.mode;
  applySettings();
});
$('#exportBtn').addEventListener('click', exportAllData);
$('#importBtn').addEventListener('click', () => importFileEl.click());
importFileEl.addEventListener('change', async () => {
  const [file] = importFileEl.files;
  if (!file) return;
  try {
    await importAllData(file);
    sendNotice('Импорт завершён', 'Настройки и история восстановлены.');
  } catch (error) {
    alert(`Не удалось импортировать данные: ${error.message}`);
  } finally {
    importFileEl.value = '';
  }
});

startBtn.addEventListener('click', start);
$('#pauseBtn').addEventListener('click', pause);
$('#resetBtn').addEventListener('click', reset);
lapBtn.addEventListener('click', addLap);
[minutesInput, secondsInput, shortBreakInput, longBreakInput, sessionsBeforeLongBreakInput, autoStartPomodoroEl, autoStartIntervalEl, warmupSecondsInput, workSecondsInput, restSecondsInput, cooldownSecondsInput, roundsInput].forEach((input) => input.addEventListener('change', reset));
[soundEl, soundTypeEl, voiceEl, wakeLockEl, volumeEl].forEach((input) => input.addEventListener('change', persist));

document.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); running ? pause() : start(); }
  if (event.key.toLowerCase() === 'r') reset();
  if (event.key.toLowerCase() === 'l') addLap();
  if (event.key.toLowerCase() === 't') $('#themeBtn').click();
  if (event.key.toLowerCase() === 'f') $('#focusBtn').click();
  if (/^[1-4]$/.test(event.key)) $$('[data-preset]')[Number(event.key) - 1]?.click();
});
window.addEventListener('hashchange', () => setMode(getModeFromHash(location.hash, mode)));
window.addEventListener('beforeunload', () => persistRuntime({ force: true }));

registerServiceWorker({ onUpdate: () => $('#updateToast').classList.remove('hidden') });
$('#reloadBtn').addEventListener('click', applyServiceWorkerUpdate);
applySettings();
