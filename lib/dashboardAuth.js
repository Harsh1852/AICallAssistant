const crypto = require('crypto');

// The dashboard shows every caller's number and full transcript, and its
// /api/takeover endpoint places a real outbound call to the owner. It also
// gets its URL texted over SMS on every incoming call, so the URL itself is
// not a secret. HTTP Basic over HTTPS is the smallest thing that actually
// closes this: the browser prompts once and remembers, and the SMS deep link
// still works.
//
// Credentials are also what stops a form POST from any page the owner happens
// to be visiting from triggering a takeover dial — Basic auth headers are not
// sent by a cross-site form submit.

function credentials() {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;
  return user && pass ? { user, pass } : null;
}

// Comparing hashes rather than the raw strings keeps the comparison
// constant-time even when the two values differ in length, which
// timingSafeEqual itself rejects outright.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseBasic(header) {
  if (!header || !header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

function requireDashboardAuth(req, res, next) {
  const creds = credentials();

  // Fail closed: with no credentials configured the dashboard is not served
  // at all, rather than served to everyone. Deploying without noticing that
  // the monitoring UI is public is the failure this prevents.
  if (!creds) {
    return res.status(503).json({
      error: 'Dashboard is disabled: set DASHBOARD_USER and DASHBOARD_PASSWORD to enable it.',
    });
  }

  const provided = parseBasic(req.header('Authorization'));
  if (provided && safeEqual(provided.user, creds.user) && safeEqual(provided.pass, creds.pass)) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="AI Phone Agent", charset="UTF-8"');
  res.status(401).json({ error: 'Authentication required.' });
}

module.exports = { requireDashboardAuth, credentials };
