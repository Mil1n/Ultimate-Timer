export function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function formatTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function getNextPomodoroState(current, config) {
  if (current.phase === 'focus') {
    const nextPhase = current.session >= config.sessionsBeforeLongBreak ? 'long' : 'short';
    return {
      phase: nextPhase,
      session: current.session,
      total: nextPhase === 'long' ? config.longBreakMinutes * 60 : config.shortBreakMinutes * 60
    };
  }

  return {
    phase: 'focus',
    session: current.phase === 'long' ? 1 : current.session + 1,
    total: config.focusSeconds
  };
}
