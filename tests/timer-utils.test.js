import assert from 'node:assert/strict';
import { clampNumber, formatTime, getNextPomodoroState } from '../timer-utils.js';

assert.equal(formatTime(0), '00:00');
assert.equal(formatTime(65.1), '01:06');
assert.equal(formatTime(3661), '01:01:01');
assert.equal(clampNumber('10', 1, 20), 10);
assert.equal(clampNumber('-5', 1, 20), 1);
assert.deepEqual(
  getNextPomodoroState({ phase: 'focus', session: 4 }, { sessionsBeforeLongBreak: 4, longBreakMinutes: 20, shortBreakMinutes: 5, focusSeconds: 1500 }),
  { phase: 'long', session: 4, total: 1200 }
);
assert.deepEqual(
  getNextPomodoroState({ phase: 'short', session: 2 }, { sessionsBeforeLongBreak: 4, longBreakMinutes: 15, shortBreakMinutes: 5, focusSeconds: 1800 }),
  { phase: 'focus', session: 3, total: 1800 }
);

console.log('timer utils tests passed');
