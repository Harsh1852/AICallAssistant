const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  activeCalls, endedCalls, initCall, sweepCalls,
  ENDED_CALL_TTL_MS, STALE_ACTIVE_CALL_MS,
} = require('../lib/callStore');

beforeEach(() => {
  for (const k of Object.keys(activeCalls)) delete activeCalls[k];
  for (const k of Object.keys(endedCalls)) delete endedCalls[k];
});

test('initCall starts a call in a clean active state', () => {
  const call = initCall('+15551234567');
  assert.equal(call.callerNumber, '+15551234567');
  assert.equal(call.status, 'active');
  assert.equal(call.turnCount, 0);
  assert.equal(call.endCallRequested, false);
  assert.equal(call.pendingAppointment, null);
  assert.deepEqual(call.history, []);
  assert.deepEqual(call.transcript, []);
});

test('sweepCalls leaves a call that is still in progress alone', () => {
  activeCalls.CA1 = initCall('+15551234567');
  sweepCalls();
  assert.ok(activeCalls.CA1, 'a fresh active call must not be swept');
  assert.equal(Object.keys(endedCalls).length, 0);
});

test('sweepCalls closes out an active call whose end callback never arrived', () => {
  // Without this, a missed /call-status webhook leaks the call and its full
  // transcript for the lifetime of the process.
  const call = initCall('+15551234567');
  call.startTime = new Date(Date.now() - STALE_ACTIVE_CALL_MS - 1000);
  activeCalls.CA1 = call;

  const stale = [];
  sweepCalls(c => stale.push(c));

  assert.equal(activeCalls.CA1, undefined, 'stale call must leave activeCalls');
  assert.ok(endedCalls.CA1, 'stale call must be preserved for logging');
  assert.equal(endedCalls.CA1.outcome, 'abandoned');
  assert.equal(endedCalls.CA1.status, 'ended');
  assert.equal(stale.length, 1, 'the callback fires so the call still gets logged');
});

test('sweepCalls discards ended calls past the retention window', () => {
  const old = initCall('+15551234567');
  old.status = 'ended';
  old.endTime = new Date(Date.now() - ENDED_CALL_TTL_MS - 1000);
  endedCalls.OLD = old;

  const fresh = initCall('+15559999999');
  fresh.status = 'ended';
  fresh.endTime = new Date();
  endedCalls.FRESH = fresh;

  sweepCalls();

  assert.equal(endedCalls.OLD, undefined, 'expired call should be dropped');
  assert.ok(endedCalls.FRESH, 'recent call should be retained');
});

test('a swept call is only reported once', () => {
  const call = initCall('+15551234567');
  call.startTime = new Date(Date.now() - STALE_ACTIVE_CALL_MS - 1000);
  activeCalls.CA1 = call;

  let count = 0;
  sweepCalls(() => count++);
  sweepCalls(() => count++);

  assert.equal(count, 1, 'a second sweep must not re-log the same call');
});
