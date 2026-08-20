const { test } = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

const { requireDashboardAuth } = require('../lib/dashboardAuth');
const { validateTwilioRequest, requestUrl } = require('../lib/webhookAuth');

// Minimal Express req/res doubles — enough to observe what the middleware does
// without standing up a server.
function fakeRes() {
  const res = { statusCode: null, headers: {}, body: null, sent: false };
  res.status = code => { res.statusCode = code; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.type = () => res;
  res.json = b => { res.body = b; res.sent = true; return res; };
  res.send = b => { res.body = b; res.sent = true; return res; };
  return res;
}

function fakeReq({ headers = {}, url = '/respond', body = {} } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    originalUrl: url,
    protocol: 'https',
    body,
    header: name => lower[name.toLowerCase()],
    get: name => lower[name.toLowerCase()],
  };
}

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

const NO_DASH = { DASHBOARD_USER: undefined, DASHBOARD_PASSWORD: undefined };
const DASH = { DASHBOARD_USER: 'admin', DASHBOARD_PASSWORD: 'correct-horse-battery' };

test('dashboard is disabled, not public, when no credentials are configured', () => {
  withEnv(NO_DASH, () => {
    const res = fakeRes();
    let nexted = false;
    requireDashboardAuth(fakeReq(), res, () => { nexted = true; });

    assert.equal(nexted, false, 'must not fall through to the handler');
    assert.equal(res.statusCode, 503);
  });
});

test('dashboard rejects a request with no credentials', () => {
  withEnv(DASH, () => {
    const res = fakeRes();
    let nexted = false;
    requireDashboardAuth(fakeReq(), res, () => { nexted = true; });

    assert.equal(nexted, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.headers['WWW-Authenticate'], /^Basic realm=/);
  });
});

test('dashboard rejects a wrong password', () => {
  withEnv(DASH, () => {
    const bad = Buffer.from('admin:wrong').toString('base64');
    const res = fakeRes();
    let nexted = false;
    requireDashboardAuth(fakeReq({ headers: { Authorization: `Basic ${bad}` } }), res, () => { nexted = true; });

    assert.equal(nexted, false);
    assert.equal(res.statusCode, 401);
  });
});

test('dashboard accepts the configured credentials', () => {
  withEnv(DASH, () => {
    const good = Buffer.from('admin:correct-horse-battery').toString('base64');
    const res = fakeRes();
    let nexted = false;
    requireDashboardAuth(fakeReq({ headers: { Authorization: `Basic ${good}` } }), res, () => { nexted = true; });

    assert.equal(nexted, true);
    assert.equal(res.sent, false);
  });
});

test('a password containing a colon is handled correctly', () => {
  // Basic auth joins user:pass with a colon, so splitting on the last one
  // instead of the first would corrupt any password containing ':'.
  withEnv({ DASHBOARD_USER: 'admin', DASHBOARD_PASSWORD: 'a:b:c' }, () => {
    const good = Buffer.from('admin:a:b:c').toString('base64');
    const res = fakeRes();
    let nexted = false;
    requireDashboardAuth(fakeReq({ headers: { Authorization: `Basic ${good}` } }), res, () => { nexted = true; });
    assert.equal(nexted, true);
  });
});

test('webhook validation rejects an unsigned request', () => {
  withEnv({ TWILIO_AUTH_TOKEN: 'secret', SKIP_WEBHOOK_VALIDATION: undefined, BASE_URL: 'https://app.example.com' }, () => {
    const res = fakeRes();
    let nexted = false;
    validateTwilioRequest(fakeReq(), res, () => { nexted = true; });

    assert.equal(nexted, false, 'unsigned webhook must not reach the handler');
    assert.equal(res.statusCode, 403);
  });
});

test('webhook validation fails closed when no auth token is configured', () => {
  withEnv({ TWILIO_AUTH_TOKEN: undefined, SKIP_WEBHOOK_VALIDATION: undefined }, () => {
    const res = fakeRes();
    let nexted = false;
    validateTwilioRequest(fakeReq(), res, () => { nexted = true; });

    assert.equal(nexted, false);
    assert.equal(res.statusCode, 403);
  });
});

test('webhook validation accepts a correctly signed request', () => {
  const token = 'a-test-auth-token';
  const url   = 'https://app.example.com/respond?sid=CA123';
  const body  = { CallSid: 'CA123', SpeechResult: 'hello there' };

  withEnv({ TWILIO_AUTH_TOKEN: token, SKIP_WEBHOOK_VALIDATION: undefined, BASE_URL: 'https://app.example.com' }, () => {
    // Sign with Twilio's own helper so the test verifies interoperability
    // rather than re-implementing the signature scheme.
    const signature = twilio.getExpectedTwilioSignature(token, url, body);
    const res = fakeRes();
    let nexted = false;
    validateTwilioRequest(
      fakeReq({ url: '/respond?sid=CA123', body, headers: { 'X-Twilio-Signature': signature } }),
      res,
      () => { nexted = true; },
    );

    assert.equal(nexted, true, 'a validly signed request must be allowed through');
  });
});

test('the escape hatch skips validation only when explicitly set', () => {
  withEnv({ SKIP_WEBHOOK_VALIDATION: 'true', TWILIO_AUTH_TOKEN: undefined }, () => {
    let nexted = false;
    validateTwilioRequest(fakeReq(), fakeRes(), () => { nexted = true; });
    assert.equal(nexted, true);
  });

  // Anything other than the exact string 'true' leaves validation on, so a
  // stray value like '1' or 'false' cannot accidentally disable it.
  for (const value of ['1', 'yes', 'false', 'TRUE']) {
    withEnv({ SKIP_WEBHOOK_VALIDATION: value, TWILIO_AUTH_TOKEN: undefined }, () => {
      let nexted = false;
      validateTwilioRequest(fakeReq(), fakeRes(), () => { nexted = true; });
      assert.equal(nexted, false, `SKIP_WEBHOOK_VALIDATION=${value} must not disable validation`);
    });
  }
});

test('requestUrl reconstructs the signed URL including the query string', () => {
  withEnv({ BASE_URL: 'https://app.example.com/', PUBLIC_URL_OVERRIDE: undefined }, () => {
    assert.equal(
      requestUrl(fakeReq({ url: '/respond?sid=CA123' })),
      'https://app.example.com/respond?sid=CA123',
    );
  });
});
