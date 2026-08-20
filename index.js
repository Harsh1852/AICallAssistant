require('dotenv').config();

// Naive date/time strings like "2026-08-12T14:30:00" (no UTC offset) are
// parsed by JS using the process's system timezone, NOT the TIMEZONE env var
// below. Hosting platforms (e.g. Render) typically default their containers
// to UTC, which would silently book appointments at the wrong actual time.
// Forcing process.env.TZ here makes Date parsing consistent with TIMEZONE
// regardless of the host's default clock.
process.env.TZ = process.env.TIMEZONE || 'America/Los_Angeles';

// Checked before the server starts rather than on first use, so a missing key
// surfaces as a readable startup error instead of failing partway through a
// real call.
require('./lib/config').assertConfig();

const express = require('express');
const path = require('path');

const { requireDashboardAuth, credentials } = require('./lib/dashboardAuth');
const { validationDisabled } = require('./lib/webhookAuth');
const { startBlocklistSync } = require('./services/blocklist');
const { startCallStoreSweeper } = require('./lib/callStore');
const { logToSheets } = require('./services/sheets');

const app = express();

// Required for Twilio signature validation and correct https:// URLs behind a
// PaaS TLS terminator (Render, Railway, Fly, Heroku), which forwards the
// original scheme in X-Forwarded-Proto.
app.set('trust proxy', true);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check, deliberately public and above the auth gate so uptime pingers
// (and the platform's own probes) don't need credentials.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Twilio's webhooks are registered BEFORE the dashboard's auth gate. Order
// matters: the static handler below is mounted at '/' with a blanket auth
// middleware, so registering it first would demand Basic credentials for
// /incoming-call — which Twilio does not send, breaking every call.
app.use(require('./routes/voice'));
app.use(require('./routes/callStatus'));

// Everything past this point requires dashboard credentials. The guard is
// deliberately blanket rather than per-file: public/ only ever holds the
// dashboard, and a path-by-path allowlist would silently expose any file added
// to it later.
app.use(requireDashboardAuth);
app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./routes/dashboard'));

// ── Background jobs ───────────────────────────────────────────────────────────
startBlocklistSync();
// A swept call never reached /call-status, so nothing else will log it.
startCallStoreSweeper(call => logToSheets(call, call.outcome).catch(console.error));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 AI Phone Agent running on port ${PORT}`);

  if (credentials()) {
    console.log(`📋 Dashboard → http://localhost:${PORT}/dashboard.html`);
  } else {
    console.warn('⚠️  Dashboard disabled — set DASHBOARD_USER and DASHBOARD_PASSWORD to enable it.');
  }

  if (validationDisabled()) {
    console.warn('⚠️  SKIP_WEBHOOK_VALIDATION=true — Twilio signatures are NOT being checked. Local development only.');
  }
  console.log('');
});
