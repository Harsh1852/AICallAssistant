const { test } = require('node:test');
const assert = require('node:assert/strict');

const { __testables } = require('../services/callHistory');
const { parseDuration, parseTranscript, parseRow } = __testables;

test('parseDuration reads the "Xm Ys" format written to the sheet', () => {
  assert.equal(parseDuration('2m 30s'), 150);
  assert.equal(parseDuration('0m 45s'), 45);
  assert.equal(parseDuration('10m 0s'), 600);
  assert.equal(parseDuration('45s'), 45);
});

test('parseDuration returns 0 for unparseable input', () => {
  assert.equal(parseDuration(''), 0);
  assert.equal(parseDuration(undefined), 0);
  assert.equal(parseDuration('not a duration'), 0);
});

test('parseTranscript splits speaker-prefixed lines', () => {
  const raw = 'AI: Hello there\nCaller: I need an appointment\nSystem: Booked';
  assert.deepEqual(parseTranscript(raw), [
    { speaker: 'AI', text: 'Hello there' },
    { speaker: 'Caller', text: 'I need an appointment' },
    { speaker: 'System', text: 'Booked' },
  ]);
});

test('parseTranscript folds continuation lines into the previous message', () => {
  // An utterance containing a newline arrives as an unprefixed line and must
  // be appended rather than dropped.
  const raw = 'Caller: first line\nsecond line\nAI: reply';
  assert.deepEqual(parseTranscript(raw), [
    { speaker: 'Caller', text: 'first line\nsecond line' },
    { speaker: 'AI', text: 'reply' },
  ]);
});

test('parseTranscript ignores leading junk with no speaker', () => {
  assert.deepEqual(parseTranscript('orphan line'), []);
  assert.deepEqual(parseTranscript(''), []);
});

test('parseRow rejects rows whose timestamp does not parse', () => {
  // Catches both a hand-added header row and a half-written append.
  assert.equal(parseRow(['Timestamp', 'Caller', 'Duration', 'Outcome', '3', 'AI: hi'], 0), null);
  assert.equal(parseRow([], 0), null);
});

test('parseRow derives start time by backing out the duration', () => {
  const row = ['2026-03-04T10:05:00Z', '+15551234567', '2m 0s', 'completed', '4', 'AI: hi'];
  const parsed = parseRow(row, 7);

  assert.equal(parsed.callerNumber, '+15551234567');
  assert.equal(parsed.duration, 120);
  assert.equal(parsed.status, 'ended');
  assert.equal(parsed.historical, true);
  assert.equal(parsed.callSid, 'hist-7');
  assert.equal(
    new Date(parsed.endTime).getTime() - new Date(parsed.startTime).getTime(),
    120 * 1000,
  );
});

test('parseRow preserves blocked and taken-over as distinct statuses', () => {
  const at = '2026-03-04T10:05:00Z';
  assert.equal(parseRow([at, '+1555', '0m 0s', 'blocked', '1', ''], 0).status, 'blocked');
  assert.equal(parseRow([at, '+1555', '1m 0s', 'taken-over', '2', ''], 0).status, 'taken-over');
  assert.equal(parseRow([at, '+1555', '1m 0s', 'completed', '2', ''], 0).status, 'ended');
});
