const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calendarEnabled, calendarTools } = require('../services/calendar');

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('calendarEnabled requires both a calendar id and credentials', () => {
  const creds = '{"type":"service_account"}';
  assert.equal(withEnv({ GOOGLE_CALENDAR_ID: 'c@g', GOOGLE_CREDENTIALS_JSON: creds }, calendarEnabled), true);
  assert.equal(withEnv({ GOOGLE_CALENDAR_ID: 'c@g', GOOGLE_CREDENTIALS_JSON: undefined }, calendarEnabled), false);
  assert.equal(withEnv({ GOOGLE_CALENDAR_ID: undefined, GOOGLE_CREDENTIALS_JSON: creds }, calendarEnabled), false);
});

test('no calendar tools are advertised when calendar is not configured', () => {
  const tools = withEnv({ GOOGLE_CALENDAR_ID: undefined, GOOGLE_CREDENTIALS_JSON: undefined }, calendarTools);
  assert.deepEqual(tools, []);
});

test('confirm_appointment is never exposed as a model-callable tool', () => {
  // Booking is confirmed only by the caller pressing 1, which bypasses the
  // LLM entirely. If this tool ever appears in the schema, a misheard "yes"
  // or a prompt injection could write to the calendar.
  const tools = withEnv(
    { GOOGLE_CALENDAR_ID: 'c@g', GOOGLE_CREDENTIALS_JSON: '{"type":"service_account"}' },
    calendarTools,
  );
  const names = tools.map(t => t.function.name);
  assert.deepEqual(names, ['check_availability', 'propose_appointment']);
  assert.ok(!names.includes('confirm_appointment'));
});

test('propose_appointment requires a name and a purpose', () => {
  const tools = withEnv(
    { GOOGLE_CALENDAR_ID: 'c@g', GOOGLE_CREDENTIALS_JSON: '{"type":"service_account"}' },
    calendarTools,
  );
  const propose = tools.find(t => t.function.name === 'propose_appointment');
  for (const field of ['date', 'startTime', 'purpose', 'callerName']) {
    assert.ok(propose.function.parameters.required.includes(field), `${field} must be required`);
  }
});

const { resolveDuration, DEFAULT_DURATION_MINUTES, MAX_DURATION_MINUTES } =
  require('../services/calendar').__testables;

test('resolveDuration defaults when the caller gave no length', () => {
  for (const input of [undefined, null, '', 'half an hour', 0, -15]) {
    assert.equal(resolveDuration(input), DEFAULT_DURATION_MINUTES, `failed for ${JSON.stringify(input)}`);
  }
});

test('resolveDuration caps overlong requests', () => {
  assert.equal(resolveDuration('120'), MAX_DURATION_MINUTES);
  assert.equal(resolveDuration(90), MAX_DURATION_MINUTES);
});

test('resolveDuration accepts numeric strings, which is what the model sends', () => {
  // durationMinutes is declared as a string in the tool schema because some
  // providers emit numeric-looking strings for number fields.
  assert.equal(resolveDuration('30'), 30);
  assert.equal(resolveDuration('45'), 45);
  assert.equal(resolveDuration(20), 20);
});
