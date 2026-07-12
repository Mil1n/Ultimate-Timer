import { clampNumber, formatTime, getNextPomodoroState } from './timer-utils.js';

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
const radius = 94;
const circumference = 2 * Math.PI * radius;
progress.style.strokeDasharray = `${circumference}`;

const defaultSettings = {
  mode: 'countdown', theme: 'dark', sound: true, soundType: 'classic', voice: false, wakeLock: false, volume: 0.25,
  minutes: 25, seconds: 0, shortBreakMinutes: 5, longBreakMinutes: 15, sessionsBeforeLongBreak: 4,
  autoStartPomodoro: false, autoStartInterval: true, warmupSeconds: 0, workSeconds: 40, restSeconds: 20, cooldownSeconds: 0, rounds: 8,
  customPresets: [], history: []
};
const settings = { ...defaultSettings, ...store.get('ultimateTimerSettings', {}) };
let runtime = store.get('ultimateTimerRuntime', null);
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
let wakeLock = null;

function persist() {
  store.set('ultimateTimerSettings', {
    ...settings,
    mode, sound: soundEl.checked, soundType: soundTypeEl.value, voice: voiceEl.checked, wakeLock: wakeLockEl.checked,
    volume: Number(volumeEl.value), minutes: clampNumber(minutesInput.value, 0, 600), seconds: clampNumber(secondsInput.value, 0, 59),
    shortBreakMinutes: clampNumber(shortBreakInput.value, 1, 120), longBreakMinutes: clampNumber(longBreakInput.value, 1, 240),
    sessionsBeforeLongBreak: clampNumber(sessionsBeforeLongBreakInput.value, 1, 12), autoStartPomodoro: autoStartPomodoroEl.checked,
    autoStartInterval: autoStartIntervalEl.checked, warmupSeconds: clampNumber(warmupSecondsInput.value, 0, 3600),
    workSeconds: clampNumber(workSecondsInput.value, 1, 3600), restSeconds: clampNumber(restSecondsInput.value, 0, 3600),
    cooldownSeconds: clampNumber(cooldownSecondsInput.value, 0, 3600), rounds: clampNumber(roundsInput.value, 1, 99)
  });
}
function persistRuntime() {
  store.set('ultimateTimerRuntime', { mode, running, total, remaining, elapsed, laps, intervalState, pomodoroState, savedAt: Date.now(), targetAt: running && mode !== 'stopwatch' ? Date.now() + remaining * 1000 : null, startedAtEpoch: running && mode === 'stopwatch' ? Date.now() - elapsed * 1000 : null });
}
const pomodoroConfig = () => ({ focusSeconds: getCountdownTotal(), shortBreakMinutes: clampNumber(shortBreakInput.value, 1, 120), longBreakMinutes: clampNumber(longBreakInput.value, 1, 240), sessionsBeforeLongBreak: clampNumber(sessionsBeforeLongBreakInput.value, 1, 12) });
const getCountdownTotal = () => Math.max(1, clampNumber(minutesInput.value, 0, 600) * 60 + clampNumber(secondsInput.value, 0, 59));
const getIntervalPhaseTotal = () => ({ warmup: clampNumber(warmupSecondsInput.value, 0, 3600), work: clampNumber(workSecondsInput.value, 1, 3600), rest: Math.max(1, clampNumber(restSecondsInput.value, 0, 3600)), cooldown: Math.max(1, clampNumber(cooldownSecondsInput.value, 0, 3600)) })[intervalState.phase] || 1;
const getCurrentTime = () => mode === 'stopwatch' ? elapsed : mode === 'interval' ? intervalState.phaseRemaining : remaining;
function getProgressRatio() { return mode === 'stopwatch' ? Math.min(1, (elapsed % 60) / 60) : mode === 'interval' ? intervalState.phaseRemaining / getIntervalPhaseTotal() : remaining / total; }
const modeLabel = () => ({ countdown: 'Таймер', stopwatch: 'Секундомер', pomodoro: 'Pomodoro', interval: 'Интервалы' })[mode];
function setPhaseClass() { document.body.dataset.phase = mode === 'interval' ? intervalState.phase : mode === 'pomodoro' ? pomodoroState.phase : mode; }
function getPhaseText() {
  if (mode === 'pomodoro') return `${{ focus: 'Фокус', short: 'Короткий перерыв', long: 'Длинный перерыв' }[pomodoroState.phase]} • сессия ${pomodoroState.session}/${clampNumber(sessionsBeforeLongBreakInput.value, 1, 12)}`;
  if (mode === 'interval') return `${{ warmup: 'Разминка', work: 'Работа', rest: 'Отдых', cooldown: 'Заминка' }[intervalState.phase]} • раунд ${intervalState.round}/${clampNumber(roundsInput.value, 1, 99)}`;
  if (mode === 'stopwatch') return laps.length ? `Кругов: ${laps.length}` : 'Секундомер готов';
  return remaining === 0 ? 'Время вышло' : 'Готов к запуску';
}
function render() {
  setPhaseClass();
  display.textContent = formatTime(getCurrentTime());
  progress.style.strokeDashoffset = `${circumference * (1 - Math.max(0, Math.min(1, getProgressRatio())))}`;
  phaseCard.textContent = getPhaseText();
  cycleProgress.textContent = mode === 'pomodoro' ? `Цикл: ${pomodoroState.session}/${clampNumber(sessionsBeforeLongBreakInput.value, 1, 12)}` : mode === 'interval' ? `Фаза: ${intervalState.phase}` : '';
  statusEl.textContent = `Режим: ${modeLabel()}${running ? ' • работает' : ''}`;
  startBtn.textContent = running ? 'Идёт…' : 'Старт';
  startBtn.disabled = running;
  pauseBtn.disabled = !running;
  lapBtn.disabled = mode === 'countdown' && !running;
  persistRuntime();
}
function speak(text) { if (voiceEl.checked && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
function notify(title, body) { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: 'icons/icon.svg' }); speak(`${title}. ${body}`); }
function beep(repeats = 1) {
  if (!soundEl.checked) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const patterns = { classic: [880, 660], soft: [523, 659], alert: [988, 784, 988] };
  const tones = patterns[soundTypeEl.value] || patterns.classic;
  for (let i = 0; i < repeats; i += 1) {
    const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = tones[i % tones.length]; gain.gain.setValueAtTime(Number(volumeEl.value), ctx.currentTime + i * 0.22);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.18); osc.start(ctx.currentTime + i * 0.22); osc.stop(ctx.currentTime + i * 0.22 + 0.2);
  }
  if ('vibrate' in navigator) navigator.vibrate([120, 70, 120]);
}
async function updateWakeLock() { if (wakeLock) { await wakeLock.release(); wakeLock = null; } if (running && wakeLockEl.checked && 'wakeLock' in navigator) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} } }
function start() { if (running) return; if ((mode === 'countdown' || mode === 'pomodoro') && remaining <= 0) reset(); if (mode === 'interval' && intervalState.phaseRemaining <= 0) reset(); running = true; startedAt = performance.now(); baseRemaining = getCurrentTime(); baseElapsed = elapsed; rafId = requestAnimationFrame(updateClock); updateWakeLock(); render(); }
function pause() { if (!running) return; running = false; cancelAnimationFrame(rafId); updateWakeLock(); render(); }
function updateClock(now) {
  if (!running) return;
  const diff = (now - startedAt) / 1000;
  if (mode === 'stopwatch') elapsed = baseElapsed + diff;
  else if (mode === 'interval') { intervalState.phaseRemaining = baseRemaining - diff; if (intervalState.phaseRemaining <= 0) advanceInterval(); }
  else { remaining = baseRemaining - diff; if (remaining <= 0) finishCountdownLikeMode(); }
  render(); if (running) rafId = requestAnimationFrame(updateClock);
}
function finishCountdownLikeMode() {
  remaining = 0; running = false; cancelAnimationFrame(rafId); beep(3);
  if (mode === 'pomodoro') { addHistory(`Pomodoro: ${getPhaseText()}`, total); advancePomodoro(); notify('Pomodoro завершён', getPhaseText()); if (autoStartPomodoroEl.checked) start(); }
  else { addHistory(`Таймер: ${formatTime(total)}`, total); notify('Таймер завершён', 'Заданное время истекло.'); }
}
function advancePomodoro() { const next = getNextPomodoroState(pomodoroState, pomodoroConfig()); pomodoroState = { phase: next.phase, session: next.session }; total = next.total; remaining = total; }
function advanceInterval() {
  beep(1); const rounds = clampNumber(roundsInput.value, 1, 99); const rest = clampNumber(restSecondsInput.value, 0, 3600); const cooldown = clampNumber(cooldownSecondsInput.value, 0, 3600);
  if (intervalState.phase === 'warmup') intervalState = { phase: 'work', round: 1, phaseRemaining: clampNumber(workSecondsInput.value, 1, 3600) };
  else if (intervalState.phase === 'work' && rest > 0) intervalState = { ...intervalState, phase: 'rest', phaseRemaining: rest };
  else if (intervalState.round < rounds) intervalState = { phase: 'work', round: intervalState.round + 1, phaseRemaining: clampNumber(workSecondsInput.value, 1, 3600) };
  else if (cooldown > 0 && intervalState.phase !== 'cooldown') intervalState = { phase: 'cooldown', round: rounds, phaseRemaining: cooldown };
  else { running = false; cancelAnimationFrame(rafId); intervalState.phaseRemaining = 0; addHistory(`Интервалы: ${rounds} раундов`, rounds * clampNumber(workSecondsInput.value, 1, 3600)); notify('Интервальная тренировка завершена', `${rounds} раундов выполнено.`); beep(3); return; }
  startedAt = performance.now(); baseRemaining = intervalState.phaseRemaining; notify('Новый интервал', getPhaseText()); if (!autoStartIntervalEl.checked) pause();
}
function reset() {
  if (running) pause();
  if (mode === 'stopwatch') elapsed = 0;
  else if (mode === 'interval') { const warmup = clampNumber(warmupSecondsInput.value, 0, 3600); intervalState = { phase: warmup > 0 ? 'warmup' : 'work', round: 1, phaseRemaining: warmup > 0 ? warmup : clampNumber(workSecondsInput.value, 1, 3600) }; remaining = intervalState.phaseRemaining; }
  else { total = getCountdownTotal(); remaining = total; if (mode === 'pomodoro') pomodoroState = { phase: 'focus', session: 1 }; }
  laps = []; lapsEl.replaceChildren(); persist(); render();
}
function addLap() { const row = document.createElement('div'); row.className = 'lap'; const name = document.createElement('span'); const value = document.createElement('strong'); laps.unshift(getCurrentTime()); name.textContent = `Круг ${laps.length}`; value.textContent = formatTime(laps[0]); row.append(name, value); lapsEl.prepend(row); render(); }
function addHistory(label, duration = 0) { settings.history = [{ label, duration, mode, at: new Date().toLocaleString('ru-RU'), day: new Date().toISOString().slice(0, 10) }, ...settings.history].slice(0, 50); persist(); renderHistory(); renderStats(); }
function renderHistory() { historyEl.replaceChildren(); if (!settings.history?.length) { const empty = document.createElement('div'); empty.className = 'stat'; empty.textContent = 'История завершённых сессий появится здесь.'; historyEl.append(empty); return; } settings.history.forEach((item) => { const row = document.createElement('div'); row.className = 'history-item'; const label = document.createElement('span'); const time = document.createElement('time'); label.textContent = item.label; time.textContent = item.at; row.append(label, time); historyEl.append(row); }); }
function renderStats() { const today = new Date().toISOString().slice(0, 10); const todayItems = settings.history.filter((item) => item.day === today); const focus = todayItems.filter((item) => item.mode === 'pomodoro' || item.mode === 'countdown').reduce((sum, item) => sum + (item.duration || 0), 0); statsEl.textContent = `Сегодня: ${todayItems.length} сессий • фокус ${formatTime(focus)}`; }
function renderCustomPresets() { customPresetsEl.replaceChildren(); settings.customPresets.forEach((preset, index) => { const chip = document.createElement('span'); chip.className = 'preset-chip'; const button = document.createElement('button'); button.className = 'pill'; button.type = 'button'; button.dataset.customPreset = String(preset.seconds); button.textContent = `${preset.name} ${formatTime(preset.seconds)}`; const del = document.createElement('button'); del.className = 'delete-preset'; del.type = 'button'; del.dataset.deletePreset = String(index); del.setAttribute('aria-label', `Удалить ${preset.name}`); del.textContent = '×'; chip.append(button, del); customPresetsEl.append(chip); }); }
function setMode(nextMode, shouldReset = true) { mode = nextMode; $$('[data-mode]').forEach((btn) => { const active = btn.dataset.mode === mode; btn.classList.toggle('active', active); btn.setAttribute('aria-selected', String(active)); }); $$('.mode-panel').forEach((panel) => panel.classList.toggle('hidden', !panel.dataset.panel.split(' ').includes(mode))); presetForm.classList.toggle('hidden', mode === 'stopwatch' || mode === 'interval'); customPresetsEl.classList.toggle('hidden', mode === 'stopwatch' || mode === 'interval'); if (shouldReset) reset(); persist(); render(); }
function applyPreset(sec) { minutesInput.value = Math.floor(sec / 60); secondsInput.value = sec % 60; setMode(mode === 'pomodoro' ? 'pomodoro' : 'countdown'); }
function applySettings() {
  document.body.classList.toggle('light', settings.theme === 'light'); $('#themeBtn').setAttribute('aria-pressed', String(settings.theme === 'light'));
  minutesInput.value = settings.minutes; secondsInput.value = settings.seconds; shortBreakInput.value = settings.shortBreakMinutes; longBreakInput.value = settings.longBreakMinutes; sessionsBeforeLongBreakInput.value = settings.sessionsBeforeLongBreak;
  autoStartPomodoroEl.checked = settings.autoStartPomodoro; autoStartIntervalEl.checked = settings.autoStartInterval; warmupSecondsInput.value = settings.warmupSeconds; workSecondsInput.value = settings.workSeconds; restSecondsInput.value = settings.restSeconds; cooldownSecondsInput.value = settings.cooldownSeconds; roundsInput.value = settings.rounds;
  soundEl.checked = settings.sound; soundTypeEl.value = settings.soundType; voiceEl.checked = settings.voice; wakeLockEl.checked = settings.wakeLock; volumeEl.value = settings.volume;
  renderCustomPresets(); renderHistory(); renderStats(); setMode(mode, false); restoreRuntime();
}
function restoreRuntime() {
  if (!runtime || runtime.mode !== mode) { reset(); return; }
  total = runtime.total || total; laps = runtime.laps || []; pomodoroState = runtime.pomodoroState || pomodoroState; intervalState = runtime.intervalState || intervalState;
  if (runtime.running && mode === 'stopwatch') elapsed = Math.max(0, (Date.now() - runtime.startedAtEpoch) / 1000);
  else if (runtime.running && runtime.targetAt) { const left = (runtime.targetAt - Date.now()) / 1000; if (mode === 'interval') intervalState.phaseRemaining = Math.max(0, left); else remaining = Math.max(0, left); }
  else { remaining = runtime.remaining ?? remaining; elapsed = runtime.elapsed ?? elapsed; }
  if (runtime.running && getCurrentTime() > 0) start(); else render();
}

$$('[data-mode]').forEach((btn, index, tabs) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
  btn.addEventListener('keydown', (event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const dir = event.key === 'ArrowRight' ? 1 : -1; tabs[(index + dir + tabs.length) % tabs.length].focus(); } });
});
$$('[data-preset]').forEach((btn) => btn.addEventListener('click', () => applyPreset(Number(btn.dataset.preset))));
customPresetsEl.addEventListener('click', (event) => { const del = event.target.closest('[data-delete-preset]'); if (del) { settings.customPresets.splice(Number(del.dataset.deletePreset), 1); persist(); renderCustomPresets(); return; } const preset = event.target.closest('[data-custom-preset]'); if (preset) applyPreset(Number(preset.dataset.customPreset)); });
presetForm.addEventListener('submit', (event) => { event.preventDefault(); const minutes = clampNumber($('#presetMinutes').value, 0, 600); const seconds = clampNumber($('#presetSeconds').value, 0, 59); const totalSeconds = Math.max(1, minutes * 60 + seconds); settings.customPresets.push({ name: $('#presetName').value.trim() || 'Пресет', seconds: totalSeconds }); $('#presetName').value = ''; $('#presetMinutes').value = ''; $('#presetSeconds').value = ''; persist(); renderCustomPresets(); });
$('#themeBtn').addEventListener('click', () => { settings.theme = document.body.classList.toggle('light') ? 'light' : 'dark'; $('#themeBtn').setAttribute('aria-pressed', String(settings.theme === 'light')); persist(); });
$('#notifyBtn').addEventListener('click', async () => { if ('Notification' in window) await Notification.requestPermission(); });
$('#testSoundBtn').addEventListener('click', () => { beep(2); speak('Проверка звука'); });
$('#focusBtn').addEventListener('click', async () => { document.body.classList.toggle('focus-mode'); if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else if (document.exitFullscreen) await document.exitFullscreen(); });
$('#clearHistoryBtn').addEventListener('click', () => { settings.history = []; persist(); renderHistory(); renderStats(); });
$('#exportBtn').addEventListener('click', () => { const blob = new Blob([JSON.stringify(settings.history, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ultimate-timer-history.json'; a.click(); URL.revokeObjectURL(a.href); });
startBtn.addEventListener('click', start); $('#pauseBtn').addEventListener('click', pause); $('#resetBtn').addEventListener('click', reset); lapBtn.addEventListener('click', addLap);
[minutesInput, secondsInput, shortBreakInput, longBreakInput, sessionsBeforeLongBreakInput, autoStartPomodoroEl, autoStartIntervalEl, warmupSecondsInput, workSecondsInput, restSecondsInput, cooldownSecondsInput, roundsInput, soundEl, soundTypeEl, voiceEl, wakeLockEl, volumeEl].forEach((input) => input.addEventListener('change', input === soundEl || input === volumeEl || input === soundTypeEl || input === voiceEl || input === wakeLockEl ? persist : reset));
document.addEventListener('keydown', (event) => { if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return; if (event.code === 'Space') { event.preventDefault(); running ? pause() : start(); } if (event.key.toLowerCase() === 'r') reset(); if (event.key.toLowerCase() === 'l') addLap(); if (event.key.toLowerCase() === 't') $('#themeBtn').click(); if (event.key.toLowerCase() === 'f') $('#focusBtn').click(); if (/^[1-4]$/.test(event.key)) $$('[data-preset]')[Number(event.key) - 1]?.click(); });
if ('serviceWorker' in navigator) { window.addEventListener('load', async () => { const registration = await navigator.serviceWorker.register('sw.js'); registration.addEventListener('updatefound', () => { const worker = registration.installing; worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) $('#updateToast').classList.remove('hidden'); }); }); }); navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload()); }
$('#reloadBtn').addEventListener('click', () => navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' }));
window.addEventListener('beforeunload', persistRuntime);
applySettings();
