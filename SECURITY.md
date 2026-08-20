# Security

Read this before you deploy. This is not boilerplate — running this app means
handling other people's phone calls, and the failure modes are real.

If you find a security problem, please **don't** open a public issue. Use
GitHub's private vulnerability reporting (the **Security** tab → *Report a
vulnerability*).

## What this application handles

Before deploying, understand what's at stake. This app processes:

- **Live phone calls** — it can place outbound calls that you are billed for.
- **Caller phone numbers** — personal data under GDPR/CCPA and similar laws.
- **Call transcripts** — whatever a real person said on the phone, written to a
  Google Sheet and shown in the dashboard.
- **Credentials** — a Twilio auth token, an LLM API key, and a Google
  service-account key.

Leaking the dashboard leaks other people's phone numbers and conversations, not
just your own data.

## What the app does to protect itself

| Control | Where |
| --- | --- |
| Twilio request-signature verification on every voice webhook | `lib/webhookAuth.js` |
| HTTP Basic auth on the dashboard, its static files, and all `/api/*` routes | `lib/dashboardAuth.js` |
| Fails closed — no credentials means the dashboard is disabled, not public | `lib/dashboardAuth.js` |
| Constant-time credential comparison | `lib/dashboardAuth.js` |
| Startup refuses to run without required configuration | `lib/config.js` |
| Booking requires a DTMF keypress, unreachable by the LLM | `services/calendar.js` |
| Phone numbers validated before being stored or rendered | `services/blocklist.js` |
| HTML and attribute escaping in the dashboard | `public/dashboard.html` |

### Booking is deliberately out of the LLM's reach

`confirm_appointment` is never advertised as a model-callable tool. Only the
caller pressing `1` on the keypad can write to your calendar. This means a
prompt injection delivered over the phone, or a misheard "yes", cannot create
an event. `test/calendar.test.js` asserts the tool is never advertised, so if
you fork this and expose it, the test will tell you.

## Deployment requirements

- **Serve over HTTPS.** Basic auth credentials and Twilio signatures are both
  worthless over plaintext HTTP. Every recommended host does TLS by default.
- **Set a long, random `DASHBOARD_PASSWORD`.** The dashboard URL is texted to
  you on every call, so the URL is not a secret. The password is the only thing
  protecting it.
- **Never set `SKIP_WEBHOOK_VALIDATION=true` in a deployment.** It makes every
  voice endpoint callable by anyone who knows your URL — they could forge
  transcripts, spend your LLM budget, and trigger outbound calls.
- **Restrict the Google service account.** Share only a dedicated booking
  calendar at "Make changes to events", and your main calendar at
  "See only free/busy" if you use it at all. The service account should not
  have access to anything else.
- **Treat `MY_INFO` as public.** It goes into the system prompt, so a caller
  can talk the assistant into repeating any of it. Don't put your home address
  or anything else you wouldn't say to a stranger in there.

## Known limitations

These are design constraints, not bugs. Know them before you rely on this.

- **Single instance only.** Call state and the blocklist live in process
  memory. Running more than one replica will break calls mid-conversation and
  desynchronise blocklists. Do not scale horizontally without moving state to a
  shared store.
- **No rate limiting.** Signature verification is what protects the voice
  routes; there is no additional throttling. Put a rate limiter or WAF in front
  if you're worried about volume.
- **Basic auth has no session management.** There is no logout, no account
  lockout, and no audit log of dashboard access.
- **Transcripts are stored in plaintext** in Google Sheets, indefinitely. There
  is no retention policy and no deletion tooling. Add one if you have a legal
  obligation to.
- **Call recording consent is your responsibility.** Many jurisdictions require
  disclosing that a call is being transcribed or handled by an automated
  system. The default greeting identifies the assistant as an AI, but that may
  not be sufficient where you are. Check your local law.
