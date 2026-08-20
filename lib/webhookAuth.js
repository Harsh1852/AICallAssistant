const twilio = require('twilio');

// Every /incoming-call, /respond, /call-status etc. handler drives real
// telephony: placing outbound legs, spending LLM tokens, writing to the
// Sheets log. Without signature validation those URLs are an open API to
// anyone who learns BASE_URL, so validation is on by default and only an
// explicit opt-out disables it.
//
// Twilio signs the exact URL it requested, including the query string
// (?sid=...), so the reconstructed URL has to match byte for byte. Behind a
// PaaS TLS terminator (Render, Railway, Fly, Heroku) req.protocol reports
// 'http' unless the app trusts the proxy — index.js sets 'trust proxy' for
// exactly this reason. PUBLIC_URL_OVERRIDE covers setups where even the
// forwarded host is wrong (e.g. an extra CDN in front).
function requestUrl(req) {
  const base = (process.env.PUBLIC_URL_OVERRIDE || process.env.BASE_URL || '').replace(/\/$/, '');
  if (base) return base + req.originalUrl;
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

function validationDisabled() {
  return process.env.SKIP_WEBHOOK_VALIDATION === 'true';
}

function validateTwilioRequest(req, res, next) {
  if (validationDisabled()) return next();

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.header('X-Twilio-Signature');

  // Fail closed. A missing auth token is a misconfiguration, not a reason to
  // accept unsigned traffic — the alternative silently turns validation off
  // in exactly the deployment that needs it most.
  if (!authToken) {
    console.error('⛔ Rejected webhook: TWILIO_AUTH_TOKEN is not set, cannot verify signature.');
    return res.status(403).type('text/xml').send('<Response><Reject/></Response>');
  }

  const valid = twilio.validateRequest(authToken, signature, requestUrl(req), req.body || {});
  if (!valid) {
    console.error(`⛔ Rejected webhook with invalid signature: ${req.method} ${req.originalUrl}`);
    return res.status(403).type('text/xml').send('<Response><Reject/></Response>');
  }

  next();
}

module.exports = { validateTwilioRequest, requestUrl, validationDisabled };
