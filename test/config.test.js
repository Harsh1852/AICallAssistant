const { test } = require('node:test');
const assert = require('node:assert/strict');

const { missingRequired, missingLlmKey, REQUIRED } = require('../lib/config');

const ALL_KEYS = REQUIRED.map(([key]) => key);

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function allSet(extra = {}) {
  return { ...Object.fromEntries(ALL_KEYS.map(k => [k, 'set'])), ...extra };
}

test('a fully configured environment reports no problems', () => {
  withEnv(allSet({ GROQ_API_KEY: 'gsk_test', OPENAI_API_KEY: undefined }), () => {
    assert.deepEqual(missingRequired(), []);
    assert.equal(missingLlmKey(), false);
  });
});

test('each required variable is reported when absent', () => {
  for (const key of ALL_KEYS) {
    withEnv(allSet({ [key]: undefined }), () => {
      const missing = missingRequired().map(([k]) => k);
      assert.deepEqual(missing, [key], `${key} should be reported as missing`);
    });
  }
});

test('a whitespace-only value counts as missing', () => {
  withEnv(allSet({ MY_NAME: '   ' }), () => {
    assert.deepEqual(missingRequired().map(([k]) => k), ['MY_NAME']);
  });
});

test('either LLM provider key satisfies the requirement', () => {
  withEnv({ GROQ_API_KEY: 'gsk_test', OPENAI_API_KEY: undefined }, () => {
    assert.equal(missingLlmKey(), false);
  });
  withEnv({ GROQ_API_KEY: undefined, OPENAI_API_KEY: 'sk_test' }, () => {
    assert.equal(missingLlmKey(), false);
  });
  withEnv({ GROQ_API_KEY: undefined, OPENAI_API_KEY: undefined }, () => {
    assert.equal(missingLlmKey(), true);
  });
});

const { placeholderValued, isPlaceholder } = require('../lib/config');

test('the shipped .env.example values are all recognised as placeholders', () => {
  // Regression guard for the trap this exists to prevent: copying
  // .env.example to .env and starting the app used to print the success
  // banner with fake credentials.
  const examples = [
    'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'your_auth_token_here',
    'gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'https://your-app.onrender.com',
    'change_me_to_something_long_and_random',
    'your_google_sheet_id_here',
  ];
  for (const value of examples) {
    assert.equal(isPlaceholder(value), true, `should be flagged: ${value}`);
  }
});

test('configured values are not flagged as placeholders', () => {
  // These are deliberately NOT shaped like real credentials. GitHub's push
  // protection scans for provider secret formats — a Twilio SID is `AC` plus 32
  // hex digits, a Groq key is `gsk_` plus a long token — and rejects the push on
  // a match. It cannot tell a fabricated value from a live one, so a
  // realistic-looking fixture here makes the whole repository unpushable.
  // Keep these obviously synthetic; the assertion only needs values that carry
  // none of the placeholder markers.
  const configured = [
    'AC-synthetic-sid-for-tests',
    'llmkey-synthetic-for-tests',
    'https://my-agent.onrender.com',
    'aB9%kQ2m$Xv7Lp4z',
    '+15550123456',
    'Alex',
  ];
  for (const value of configured) {
    assert.equal(isPlaceholder(value), false, `should NOT be flagged: ${value}`);
  }
});

test('a placeholder credential is rejected rather than accepted as set', () => {
  withEnv(allSet({ TWILIO_AUTH_TOKEN: 'your_auth_token_here', GROQ_API_KEY: 'llmkey-synthetic-for-tests' }), () => {
    // It is present and non-empty, so it is not "missing"...
    assert.deepEqual(missingRequired().map(([k]) => k), []);
    // ...but it must still be reported as a placeholder.
    assert.deepEqual(placeholderValued().map(([k]) => k), ['TWILIO_AUTH_TOKEN']);
  });
});

test('a placeholder LLM key does not satisfy the provider requirement', () => {
  withEnv({ GROQ_API_KEY: 'gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', OPENAI_API_KEY: undefined }, () => {
    assert.equal(missingLlmKey(), true);
  });
  withEnv({ GROQ_API_KEY: 'llmkey-synthetic-for-tests', OPENAI_API_KEY: undefined }, () => {
    assert.equal(missingLlmKey(), false);
  });
});

test('the example dashboard password is refused', () => {
  withEnv(allSet({ DASHBOARD_PASSWORD: 'change_me_to_something_long_and_random' }), () => {
    assert.deepEqual(placeholderValued().map(([k]) => k), ['DASHBOARD_PASSWORD']);
  });
  withEnv(allSet({ DASHBOARD_PASSWORD: 'aB9%kQ2m$Xv7Lp4z' }), () => {
    assert.deepEqual(placeholderValued().map(([k]) => k), []);
  });
});
