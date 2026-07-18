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

export function getModeFromHash(hash, fallback = 'countdown') {
  const mode = String(hash || '').replace('#', '');
  return ['countdown', 'stopwatch', 'pomodoro', 'interval'].includes(mode) ? mode : fallback;
}

export function buildStats(history, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);
  const weekStart = weekAgo.toISOString().slice(0, 10);

  const totals = history.reduce((acc, item) => {
    const duration = item.duration || 0;
    acc.allSessions += 1;
    acc.byMode[item.mode] = (acc.byMode[item.mode] || 0) + duration;
    if (item.day === today) {
      acc.todaySessions += 1;
      acc.todayFocus += ['pomodoro', 'countdown'].includes(item.mode) ? duration : 0;
      acc.todayTraining += item.mode === 'interval' ? duration : 0;
    }
    if (item.day >= weekStart && item.day <= today) {
      acc.weekSessions += 1;
      acc.weekFocus += ['pomodoro', 'countdown'].includes(item.mode) ? duration : 0;
    }
    return acc;
  }, {
    allSessions: 0,
    todaySessions: 0,
    todayFocus: 0,
    todayTraining: 0,
    weekSessions: 0,
    weekFocus: 0,
    byMode: {}
  });

  return totals;
}
