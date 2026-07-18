import assert from 'node:assert/strict';
import { buildStats, clampNumber, formatTime, getModeFromHash, getNextPomodoroState } from '../timer-utils.js';

assert.equal(formatTime(0), '00:00');
assert.equal(formatTime(65.1), '01:06');
assert.equal(formatTime(3661), '01:01:01');
assert.equal(clampNumber('10', 1, 20), 10);
assert.equal(clampNumber('-5', 1, 20), 1);
assert.equal(getModeFromHash('#pomodoro'), 'pomodoro');
assert.equal(getModeFromHash('#unknown', 'stopwatch'), 'stopwatch');
assert.deepEqual(
  getNextPomodoroState({ phase: 'focus', session: 4 }, { sessionsBeforeLongBreak: 4, longBreakMinutes: 20, shortBreakMinutes: 5, focusSeconds: 1500 }),
  { phase: 'long', session: 4, total: 1200 }
);
assert.deepEqual(
  getNextPomodoroState({ phase: 'short', session: 2 }, { sessionsBeforeLongBreak: 4, longBreakMinutes: 15, shortBreakMinutes: 5, focusSeconds: 1800 }),
  { phase: 'focus', session: 3, total: 1800 }
);
assert.deepEqual(
  buildStats([
    { mode: 'pomodoro', duration: 1500, day: '2026-07-18' },
    { mode: 'interval', duration: 600, day: '2026-07-18' },
    { mode: 'countdown', duration: 300, day: '2026-07-15' }
  ], new Date('2026-07-18T12:00:00Z')),
  {
    allSessions: 3,
    todaySessions: 2,
    todayFocus: 1500,
    todayTraining: 600,
    weekSessions: 3,
    weekFocus: 1800,
    byMode: { pomodoro: 1500, interval: 600, countdown: 300 }
  }
);

console.log('timer utils tests passed');
