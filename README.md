# AI Phone Agent

A self-hosted AI receptionist for your phone number. It answers calls you can't
take, holds a real conversation, books appointments on your calendar, logs every
transcript, and hands the call over to you the moment you want it.

Built with Twilio, an LLM of your choice (Groq or OpenAI), and Google
Sheets/Calendar. Runs on a free hosting tier for about the cost of a phone
number.

[![CI](https://github.com/Harsh1852/AICallAssistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Harsh1852/AICallAssistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

> **Before you deploy this**, read [SECURITY.md](SECURITY.md). This app handles
> other people's phone numbers and recorded conversations, and can place calls
> you get billed for.

**Contents** · [What it does](#what-it-does) · [How it works](#how-it-works) ·
[Cost](#stack-and-cost) · [Setup](#setup) · [Configuration](#configuration) ·
[Features](#features) · [Customization](#customization) ·
[Development](#development) · [Troubleshooting](#troubleshooting)

---

## What it does

- **Rings you first.** Your own phone gets a chance to pick up before the AI
  ever answers. If you answer, the AI stays out of it entirely.
- **Talks like a person.** Speech in, speech out, over a normal phone call. No
  app, nothing for the caller to install.
- **Knows your context.** You write a short brief (`MY_INFO`) describing who you
  are and what the assistant should collect. It never invents anything beyond it.
- **Books appointments.** Optionally checks your real calendar for conflicts and
  schedules onto a dedicated bookings calendar — confirmed by a keypress, never
  by voice.
- **Hands over on demand.** The caller presses `0`, or you click *Take Over* in
  the dashboard, and the call transfers to you.
- **Logs everything.** Full transcripts, durations, and outcomes to a Google
  Sheet you own.
- **Blocks nuisance callers.** Rejected before the call is answered, so there's
  no charge and no ring.

**Use it for** job hunting (screening recruiter calls when you can't pick up), a
small business that can't staff a phone line, freelancing, or just not answering
unknown numbers while still not missing anything that matters.

---

## How it works

```
Someone calls your Twilio number
            │
            ▼
   Blocklist check → blocked? <Reject> before answering, no charge
            │
            ▼
Twilio rings your real phone (10s by default)
            │
       ┌────┴────┐
  You answer    You don't answer
       │              │
  Normal call         ▼
  AI never      AI greets the caller
  involved      using your MY_INFO brief
       │              │
       │              ▼
       │      Conversation loop:
       │      caller speaks → LLM replies → Twilio speaks it back
       │      (optionally: checks calendar, proposes a time,
       │       books it when the caller presses 1)
       │              │
       │         ┌────┴─────┬──────────────┐
       │    Caller     Caller presses 0   You click
       │    hangs up   or you take over   "Take Over"
       │         │          │                  │
       ▼         ▼          └────────┬─────────┘
   Logged to Google Sheets           ▼
                             AI announces the handoff,
                             Twilio dials you, you're connected
```

---

## Stack and cost

| Layer | Service | Cost |
| --- | --- | --- |
| Phone number and call routing | Twilio | ~$1.15/month + ~$0.014/min |
| Speech to text and text to speech | Twilio (built in) | included in per-minute |
| LLM | Groq, or OpenAI | Groq has a free tier |
| Hosting | Render, Railway, Fly.io, or your own box | free tier available |
| Call log and blocklist | Google Sheets | free |
| Calendar booking (optional) | Google Calendar | free |

**Realistic monthly cost: about $1–3** for light personal use, dominated by the
Twilio number rental.

Nothing here is locked in. Any host that serves HTTPS and runs Node works, and
the LLM is one environment variable.

---

## Setup

Two paths. If you've deployed a Node app before, the quickstart is all you need.
If you haven't, the full walkthrough assumes no prior experience and takes about
2–3 hours, mostly waiting on account signups.

You do **not** need to write or understand any code either way.

### Quickstart

Requires Node 20+, a Twilio account with a phone number, and an LLM API key.

```bash
git clone https://github.com/Harsh1852/AICallAssistant.git
```

```bash
cd AICallAssistant && npm install && cp .env.example .env
```

Fill in `.env` — at minimum `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_PHONE_NUMBER`, `GROQ_API_KEY` (or `OPENAI_API_KEY`), `MY_NAME`,
`MY_INFO`, and `BASE_URL`. Add `DASHBOARD_USER` and `DASHBOARD_PASSWORD` to
enable the dashboard.

You have to replace the placeholder values, not just keep them. The app refuses
to start if a required variable is missing **or** still set to its
`.env.example` placeholder, and names each one — so a copied-but-unedited
config fails loudly at startup instead of quietly failing on your first real
call.

```bash
npm start
```

Twilio needs to reach you over HTTPS, so for local development expose your port
with a tunnel and set `BASE_URL` to the tunnel URL:

```bash
npx ngrok http 3000
```

Then set your Twilio number's webhooks to `<BASE_URL>/incoming-call` and
`<BASE_URL>/call-status`, both HTTP POST. Full detail in
[Part 7](#part-7--connect-twilio) below.

### Full walkthrough

Open a scratch file (Notepad, or anything) and keep it open — you'll paste keys
into it as you go, then transfer them into `.env` in Part 5.

**Accounts to create first.** All free except Twilio, which has a free trial.

| # | Website | Purpose |
| --- | --- | --- |
| 1 | https://twilio.com | Phone number and call routing |
| 2 | https://console.groq.com | Free LLM (no credit card needed) |
| 3 | https://github.com | Store your code online |
| 4 | https://render.com | Host your app for free |
| 5 | https://voice.google.com | Free callback number for takeover |
| 6 | https://uptimerobot.com | Keep your app awake 24/7 for free |

You'll also use your existing Google account for Sheets and Google Cloud.

> The commands below use Windows Command Prompt. On macOS or Linux the steps are
> identical apart from using Terminal, and `cp` instead of `copy`.

<details>
<summary><b>Part 1 — Install the tools</b></summary>

**Node.js**

1. Go to https://nodejs.org
2. Download the **LTS** version and run the installer
3. Accept all defaults
4. Verify: open Command Prompt and run `node --version` — you should see a
   version number like `v20.11.0`. Anything 20 or higher works.

**Git**

1. Go to https://git-scm.com/downloads
2. Download for your platform and run the installer, accepting the defaults
3. Verify: `git --version`

**VS Code** (a text editor — easier than Notepad for editing config files)

1. Go to https://code.visualstudio.com
2. Download and install
3. During install, tick **"Add to PATH"** if offered

</details>

<details>
<summary><b>Part 2 — Twilio: credentials and a phone number</b></summary>

1. Go to https://twilio.com and log in — you land on the **Console Dashboard**
2. Near the top you'll see two values:
   - **Account SID** — starts with `AC`
   - **Auth Token** — click the eye icon to reveal it
3. Copy both into your scratch file:
   ```
   TWILIO_ACCOUNT_SID = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN  = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. Now buy a number:
   - **Phone Numbers** in the left sidebar → **Manage** → **Active Numbers**
   - Click **Buy a number**
   - Search any area code, click **Buy** next to one — trial credit covers it
5. Copy the number (format `+15550000000`) into your scratch file:
   ```
   TWILIO_PHONE_NUMBER = +15550000000
   ```

> Your Auth Token does double duty: it's how the app verifies that incoming
> webhooks genuinely came from Twilio. Treat it like a password.

</details>

<details>
<summary><b>Part 3 — Get an LLM API key</b></summary>

Groq is free and needs no credit card. (If you'd rather use OpenAI, create a key
at https://platform.openai.com and set `OPENAI_API_KEY` instead — everything
else is the same.)

1. Go to https://console.groq.com and log in
2. Click **API Keys** in the left sidebar
3. Click **Create API Key**, name it `phone-agent`, click **Submit**
4. A key starting with `gsk_` appears — **copy it immediately**, you can't view
   it again after closing the dialog
5. Paste into your scratch file:
   ```
   GROQ_API_KEY = gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

</details>

<details>
<summary><b>Part 4 — A separate callback number, and Google Sheets logging</b></summary>

### A callback number for takeover

This is the number Twilio dials when you hit *Take Over*. Using your real
personal number can cause a forwarding loop, so a second number solves it
cleanly. Google Voice is free:

1. Go to https://voice.google.com and sign in
2. Click **Get a Google Voice number**
3. Search any area code, click **Select**
4. Click **Verify** — it calls your real phone with a code
5. Install the **Google Voice app** on your phone (App Store or Play Store) and
   sign in with the same account
6. Record both numbers in your scratch file:
   ```
   OWNER_PHONE_NUMBER    = +15550000002   (your Google Voice number)
   OWNER_PERSONAL_NUMBER = +15550000001   (your real mobile number)
   ```

### Create the Google Sheet

1. Go to https://sheets.google.com and click **+** for a blank spreadsheet
2. Rename it `Call Logs`
3. Put these headers in row 1, cells A1 through F1:

   | A1 | B1 | C1 | D1 | E1 | F1 |
   | --- | --- | --- | --- | --- | --- |
   | Timestamp | Caller Number | Duration | Outcome | Exchanges | Transcript |

4. Look at the browser address bar:
   ```
   https://docs.google.com/spreadsheets/d/XXXXXXXXXXXXXXXXXXX/edit
   ```
   The long string between `/d/` and `/edit` is your Sheet ID. Save it:
   ```
   GOOGLE_SHEET_ID = 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
   ```

### Create a service account

A service account is a robot Google account your app uses to write to the sheet.

1. Go to https://console.cloud.google.com and sign in
2. Click **Select a project** at the top → **NEW PROJECT**
3. Name it `ai-phone-agent`, click **Create**, and make sure it's selected in
   the top dropdown afterwards
4. In the top search bar, type `Google Sheets API`, click the result, click
   **Enable**
5. Left sidebar → **IAM & Admin** → **Service Accounts**
6. Click **+ CREATE SERVICE ACCOUNT**, name it `phone-agent`,
   **Create and Continue**, **Continue** (skip the role step), **Done**
7. Click the new service account in the list → **Keys** tab
8. **Add Key** → **Create new key** → **JSON** → **Create**
9. A `.json` file downloads. Open it in a text editor, select all, copy
10. Paste into your scratch file, **all on one line with no line breaks**:
    ```
    GOOGLE_CREDENTIALS_JSON = { entire JSON contents here }
    ```

### Share the sheet with the service account

1. In the JSON you copied, find the `"client_email"` line. It looks like
   `phone-agent@ai-phone-agent-xxxxx.iam.gserviceaccount.com`
2. Copy that email address
3. In your Google Sheet, click **Share**
4. Paste the email, set permission to **Editor**
5. Untick "Notify people", click **Share**

> Skipping this whole part is fine — calls still work. You just won't get call
> logging, the dashboard's history view, or a blocklist that survives restarts.

</details>

<details>
<summary><b>Part 5 — Get it running on your computer</b></summary>

You don't need to type out any application code. Download the project, install
its dependencies, and add your keys.

1. Open **File Explorer**, navigate to **Documents**
2. Click the address bar, type `cmd`, press Enter — a Command Prompt opens there
3. Clone the project:
   ```
   git clone https://github.com/Harsh1852/AICallAssistant.git
   ```
4. Move into the folder:
   ```
   cd AICallAssistant
   ```
5. Open it in VS Code:
   ```
   code .
   ```
6. Install dependencies:
   ```
   npm install
   ```
   A lot of text scrolls by — that's normal. You should end with something like
   `added 213 packages`, and a `node_modules` folder appears.
7. Confirm the install works by running the project's own tests. These make no
   phone calls and use no API keys, so they work before you've configured
   anything:
   ```
   npm test
   ```
8. Create your config file from the documented template:
   ```
   copy .env.example .env
   ```
9. Open `.env` in VS Code and fill in every value from your scratch file. At
   minimum:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_PHONE_NUMBER=+15550000000

   GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

   MY_NAME=Alex
   OWNER_PERSONAL_NUMBER=+15550000001
   OWNER_PHONE_NUMBER=+15550000002

   DASHBOARD_USER=admin
   DASHBOARD_PASSWORD=pick_a_long_random_password_here

   MY_INFO=I run a two-person landscaping business in the Portland area. We do garden design, planting, and seasonal maintenance. If someone is calling about a new job, take their name, address, and a rough description of what they need, then tell them we will call back with a quote within two business days. Do not quote prices over the phone and do not share my personal phone number or email.

   BASE_URL=https://placeholder.com
   GOOGLE_SHEET_ID=your_sheet_id_here
   GOOGLE_CREDENTIALS_JSON={"type":"service_account","project_id":"...entire json on one line..."}
   PORT=3000
   ```
10. Check that it starts:
    ```
    npm start
    ```
    You should see:
    ```
    🚀 AI Phone Agent running on port 3000
    📋 Dashboard → http://localhost:3000/dashboard.html
    ```
    If anything is missing — or still set to a placeholder from
    `.env.example` — it stops immediately and lists exactly which variables to
    fix. Press `Ctrl+C` to stop.

> Leave `BASE_URL` as the placeholder for now — you'll set it after deploying.
>
> **About `DASHBOARD_PASSWORD`:** the dashboard shows caller phone numbers and
> full transcripts, and can transfer a live call. The app won't serve it at all
> until you set a username and password — and the dashboard link gets texted to
> you on every call, so the URL itself is not a secret. Make the password long
> and random; a password manager can generate one.
>
> `.gitignore` already excludes `.env`, so your secrets never reach GitHub.

It can't take real calls yet — Twilio can't reach your laptop. That's what
deploying solves.

</details>

<details>
<summary><b>Part 6 — Put your copy on GitHub and deploy it</b></summary>

Render deploys from a GitHub repository, so you need your own copy there. Your
`.env` isn't part of it — you'll enter those values into Render directly.

### Push to your own repository

1. Go to https://github.com, click **+** → **New repository**
2. Name it whatever you like — `ai-phone-agent` is fine. **Private** is the safe
   default (public is fine too — the code contains no secrets — but private
   means never thinking about it)
3. Don't check any initialize options. Click **Create repository**
4. Back in your Command Prompt, point the project at *your* repo and push.
   Replace `YOUR_USERNAME` and the repository name with your own — right now
   `origin` still points at the copy you cloned from, which you can't push to:
   ```
   git remote remove origin
   ```
   ```
   git remote add origin https://github.com/YOUR_USERNAME/ai-phone-agent.git
   ```
   ```
   git add .
   ```
   ```
   git commit -m "My configuration"
   ```
   ```
   git branch -M main
   ```
   ```
   git push -u origin main
   ```
5. If GitHub asks for a password, it wants a **Personal Access Token**, not your
   account password. Create one at https://github.com/settings/tokens →
   **Generate new token (classic)** → tick the `repo` scope → copy the token and
   use it as the password.

> Downloaded the ZIP instead of cloning? Run `git init` first and skip the
> `git remote remove origin` line.

### Create the Render service

1. Go to https://render.com and click **Sign in with GitHub**
2. **New +** → **Web Service**
3. Find your `ai-phone-agent` repository, click **Connect**
4. Fill in:
   - **Name:** `ai-phone-agent`
   - **Region:** whichever is closest to you
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. **Don't click Create yet** — scroll down to Environment Variables

### Add environment variables

Add each one from your `.env`:

| Key | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Your Twilio number, e.g. `+15550000000` |
| `GROQ_API_KEY` | Your Groq API key |
| `MY_NAME` | Your first name |
| `MY_INFO` | Your full context paragraph |
| `OWNER_PERSONAL_NUMBER` | Your real mobile number |
| `OWNER_PHONE_NUMBER` | Your Google Voice number |
| `DASHBOARD_USER` | A username, e.g. `admin` |
| `DASHBOARD_PASSWORD` | A long random password |
| `BASE_URL` | Leave as `https://placeholder.com` for now |
| `GOOGLE_SHEET_ID` | Your sheet ID |
| `GOOGLE_CREDENTIALS_JSON` | The entire JSON on one line |

Then click **Create Web Service**.

### Get your URL and set BASE_URL

1. Render builds and deploys — 2–3 minutes. Watch the **Logs** tab for:
   ```
   🚀 AI Phone Agent running on port 10000
   ```
2. Render shows your public URL at the top, like
   `https://ai-phone-agent-xxxx.onrender.com`. Copy it.
3. Go to the **Environment** tab, edit `BASE_URL`, and replace the placeholder
   with your real URL — **no trailing slash**. Save Changes.

`BASE_URL` must match your real URL exactly, because it's used to verify that
webhooks genuinely came from Twilio. A mismatch shows up in the logs as
`Rejected webhook with invalid signature`.

### Verify the dashboard

Open `https://your-render-url.onrender.com/dashboard.html`.

Your browser pops up a login box — enter your `DASHBOARD_USER` and
`DASHBOARD_PASSWORD`. It'll offer to remember them, so this is once per device.
You should then see a dark dashboard with two panels ✅

Getting a **"Dashboard is disabled"** message instead means you didn't set
`DASHBOARD_USER` / `DASHBOARD_PASSWORD` in Render — add them and let it
redeploy.

</details>

<details>
<summary><b id="part-7--connect-twilio">Part 7 — Connect Twilio</b></summary>

Webhooks are URLs Twilio calls when something happens on a call.

1. Go to https://twilio.com/console
2. **Phone Numbers** → **Manage** → **Active Numbers** → click your number
3. Scroll to **Voice Configuration** and set:

   **"A call comes in"**
   - Select **Webhook**
   - URL: `https://your-render-url.onrender.com/incoming-call`
   - Method: **HTTP POST**

   **"Call status changes"**
   - URL: `https://your-render-url.onrender.com/call-status`
   - Method: **HTTP POST**

4. Click **Save configuration**

> **Both are required.** The second one is what moves calls from Live to Past on
> the dashboard and triggers Google Sheets logging.

</details>

<details>
<summary><b>Part 8 — Keep the app awake</b></summary>

Render's free tier sleeps after 15 minutes of inactivity, and a sleeping app
takes 30–60 seconds to wake — long enough that calls fail.

1. Go to https://uptimerobot.com and sign up free
2. **Add New Monitor**
3. Fill in:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `Phone Agent`
   - URL: `https://your-render-url.onrender.com/healthz`
   - Monitoring Interval: **5 minutes**
4. **Create Monitor**

> **Use `/healthz`, not `/dashboard.html`.** The dashboard requires a password,
> so UptimeRobot would get a `401 Unauthorized` and keep emailing you that your
> app is down. `/healthz` is a tiny public endpoint that exists for exactly this
> — it returns `{"ok":true}` and reveals nothing.

</details>

<details>
<summary><b>Part 9 — Test everything</b></summary>

**Test the agent**

1. Open your dashboard and let it load
2. Open the Render **Logs** tab in a second browser tab
3. Call your Twilio number from any phone
4. Within 2–3 seconds the logs should show:
   ```
   📞 Incoming call from +1XXXXXXXXXX  SID: CAxxxxxxx
   ```
5. Your own phone rings first. Let it ring out — the AI then greets the caller
6. Watch the dashboard: the transcript appears in real time ✅

**Test the takeover**

1. While a call is active, click **Take Over Call** on the dashboard
2. You should hear: *"[Your name] is available to take the call. I am connecting
   you directly to [Your name]."*
3. Your Google Voice app rings — pick up and you're live with the caller ✅

**Test logging**

1. Let a call run a minute, then hang up
2. Check your Google Sheet — a new row appears within a few seconds with
   timestamp, caller number, duration, outcome, exchange count, and the full
   transcript ✅

</details>

### Deployment checklist

- [ ] Node.js installed — `node --version` shows 20 or higher
- [ ] Git installed — `git --version` works
- [ ] Twilio account created, phone number purchased
- [ ] LLM API key generated (Groq or OpenAI)
- [ ] Google Voice (or other second) number set up for takeover
- [ ] Google Sheet created with the correct headers in row 1
- [ ] Google Cloud project created, Sheets API enabled, service-account key downloaded
- [ ] Service-account email shared on the Sheet as **Editor**
- [ ] Project cloned, `npm install` done, `npm test` passes
- [ ] `.env` created from `.env.example` with every value filled in
- [ ] `npm start` runs locally without a configuration error
- [ ] `DASHBOARD_PASSWORD` is long and random
- [ ] GitHub repository created, `origin` pointed at your own copy, code pushed
- [ ] Render service created with all environment variables set
- [ ] `BASE_URL` updated to the real Render URL, no trailing slash
- [ ] `SKIP_WEBHOOK_VALIDATION` is **not** set
- [ ] Dashboard loads and accepts your login
- [ ] Twilio webhooks set for `/incoming-call` and `/call-status` (both POST)
- [ ] Uptime monitor pointed at `/healthz`, every 5 minutes
- [ ] Test call made — AI answers, transcript appears
- [ ] Test takeover — handoff plays, callback received
- [ ] Google Sheets row appears after a call ends
- [ ] Optional: Calendar API enabled, bookings calendar shared, `GOOGLE_CALENDAR_ID` set
- [ ] Optional: test a booking — propose a time, press 1, verify the event
- [ ] Optional: `Blocklist` tab added; block a number, confirm rejection, unblock

---

## Configuration

Set these in your host's environment settings. Never commit them.
[`.env.example`](.env.example) documents every one with inline comments.

### Required

| Variable | Description | Example |
| --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account Info | `ACxxxxxxxxxx` |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account Info. Also verifies webhook signatures | `your_auth_token` |
| `TWILIO_PHONE_NUMBER` | Your Twilio number, E.164 | `+15550000000` |
| `GROQ_API_KEY` *or* `OPENAI_API_KEY` | At least one. Groq is used when both are set | `gsk_xxxx` / `sk-xxxx` |
| `MY_NAME` | The name the assistant answers on behalf of | `Alex` |
| `MY_INFO` | What the assistant knows and may say — see below | See below |
| `BASE_URL` | Public HTTPS URL of this deployment, **no trailing slash** | `https://your-app.onrender.com` |

### Required for the dashboard

| Variable | Description | Example |
| --- | --- | --- |
| `DASHBOARD_USER` | Dashboard username | `admin` |
| `DASHBOARD_PASSWORD` | Dashboard password. Long and random | — |

The app still answers calls without these, but the dashboard is **disabled**
until both are set — it returns 503 rather than serving anything. It shows
caller numbers and full transcripts and can transfer a live call, so it is never
served without credentials.

### Optional

| Variable | Description | Default |
| --- | --- | --- |
| `OWNER_PERSONAL_NUMBER` | Your real phone. Twilio rings it before the AI answers. Unset means the AI picks up immediately | unset |
| `OWNER_PHONE_NUMBER` | Where a caller is transferred on `0`, and where call-alert texts go | unset |
| `OWNER_RING_TIMEOUT_SECONDS` | How long your own phone rings before the AI takes over | `10` |
| `LLM_MODEL` | Override the model | `openai/gpt-oss-20b` on Groq, `gpt-4o` on OpenAI |
| `GOOGLE_SHEET_ID` | Enables call logging, history, and a persistent blocklist | unset |
| `GOOGLE_CREDENTIALS_JSON` | Service-account key JSON, as a single line | unset |
| `GOOGLE_CALENDAR_ID` | Enables booking. The **only** calendar the AI writes to | unset |
| `GOOGLE_MAIN_CALENDAR_ID` | Read-only conflict checking against your real calendar | unset |
| `TIMEZONE` | IANA zone for bookings and timestamps | `America/Los_Angeles` |
| `PORT` | Server port | `3000` |

### Local development only

| Variable | Description |
| --- | --- |
| `SKIP_WEBHOOK_VALIDATION` | Set to `true` to disable Twilio signature checks. **Never set this in a deployment** — it makes every voice endpoint callable by anyone with your URL |
| `PUBLIC_URL_OVERRIDE` | Override the URL used for signature verification, if your host sits behind an extra proxy or CDN |

### MY_INFO — the agent's brief

The single most important variable. Write it like you're briefing a new human
assistant on their first day: who you are, what calls to expect, what to
collect, and what not to say.

```
MY_INFO=I run a two-person landscaping business in the Portland area. We do
garden design, planting, and seasonal maintenance. If someone is calling about
a new job, take their name, address, and a rough description of what they need,
then tell them we will call back with a quote within two business days. We are
booked through the end of the month. Do not quote prices over the phone and do
not share my personal phone number or email.
```

Patterns that work well:

- **Say what to collect.** "Take their name, company, and best email" gives the
  assistant a goal for the conversation.
- **Say what to refuse.** "Do not quote prices", "do not share my address".
- **Set expectations.** "Tell them I'll respond within 24 hours."
- **Distinguish call types.** Handle business calls one way, personal another.

⚠️ **Treat `MY_INFO` as public.** It goes straight into the system prompt, so a
persistent caller can get the assistant to repeat any of it. Don't put anything
in here you wouldn't say to a stranger who called you — no home address, and no
email or number you don't want read aloud.

Change it any time by editing the environment variable and restarting. No code
changes; on Render it redeploys automatically in ~2 minutes.

---

## Features

### Dashboard

Open `https://your-app-url/dashboard.html` and sign in.

- **Live calls** — in progress, updating every 2 seconds
- **Past calls** — the last 2 hours from memory, then older calls read back from
  the Sheets log, searchable by number
- **Transcript panel** — the full conversation in real time, AI and caller turns
  separated
- **Take Over** — announces the handoff and dials you. Active only during a live
  call
- **Block** — blocks the number you're currently viewing
- **Blocklist modal** — every blocked number, with a form to add and a Remove
  button on each

### Ending the call

The AI has an `end_call` tool, always available, that it uses when the
conversation reaches a natural close: the caller says goodbye, or confirms a
message is wrapped up. It speaks one closing line and hangs up. Without it,
every call would sit open until the caller hung up or hit the "are you still
there?" timeout.

### Blocking numbers

Blocked numbers get `<Reject>` — declined *before* the call is answered, so
there's no per-minute charge, no ring to your phone, and the AI never engages.
The check runs against an in-memory cache, adding no latency to answering.

Google Sheets is the persistent backing store, so blocks survive a restart. In
the same spreadsheet as your call log, add a second tab named exactly
**`Blocklist`** with headers `Phone Number | Reason | Date Added`. No new
credentials needed — it reuses the same sheet and service account.

Without that tab, blocking still works for the current process; it just won't
survive a restart. Check your logs for `Blocklist refresh error`.

Numbers are validated before being stored: only plausible phone numbers (7–15
digits, standard punctuation) are accepted.

### Google Sheets log

Every finished call appends one row:

| A | B | C | D | E | F |
| --- | --- | --- | --- | --- | --- |
| Timestamp | Caller Number | Duration | Outcome | Exchanges | Full Transcript |

**Outcomes:**

| Value | Meaning |
| --- | --- |
| `completed` | Caller hung up normally |
| `answered-by-owner` | You picked up; the AI never engaged |
| `taken-over` | Transferred to you mid-call |
| `blocked` | Rejected by the blocklist |
| `abandoned` | No end-of-call callback arrived; closed out by the sweeper |
| `failed` / `busy` / `no-answer` | Twilio-reported call problems |

The dashboard reads this sheet back for its history view, so the log outlives
the process.

### Calendar booking (optional)

Set `GOOGLE_CALENDAR_ID` and the AI gains two tools:

- **`check_availability`** — is this slot free? Answers "are you around
  Tuesday?" without proposing anything.
- **`propose_appointment`** — checks availability and tentatively holds a slot.
  Requires a specific, concrete purpose; the assistant is instructed to ask what
  the meeting is actually about rather than accept "wants to talk". That purpose
  becomes the event title and description. Duration defaults to 30 minutes and
  is **capped at 45 in code**, not just in the prompt.

**Confirmation is keypress-only, by design.** Creating the event
(`confirm_appointment`) is deliberately **not** exposed as a tool the model can
call. The only path to a booking is the caller pressing **1** on their keypad,
handled directly in code, bypassing the LLM and speech recognition entirely.

That means a misheard "yes" cannot book, and neither can a prompt injection
delivered over the phone. If the caller tries to confirm verbally, the assistant
tells them to press 1. Availability is re-checked immediately before booking in
case something else was scheduled in the meantime. There's a test asserting the
tool is never advertised — please don't remove it.

**Setup:**

1. **Create a dedicated secondary calendar** (Google Calendar → *Other
   calendars* → *Create new calendar*, e.g. "AI Bookings"). Don't share your
   primary calendar — this scopes the AI's write access to bookings only.
2. Share it with the service-account email from `GOOGLE_CREDENTIALS_JSON`,
   granting **Make changes to events**.
3. Set `GOOGLE_CALENDAR_ID` to that calendar's ID (Settings → *Integrate
   calendar* → Calendar ID, looks like `xxxx@group.calendar.google.com`).
4. **Optional but recommended:** also share your real calendar at the
   **"See only free/busy"** level — the most restrictive tier, revealing busy
   blocks but never event titles or details — and set
   `GOOGLE_MAIN_CALENDAR_ID`. Without this the AI only sees conflicts inside the
   bookings calendar and knows nothing about your actual schedule.
5. Set `TIMEZONE` so relative dates like "next Tuesday" resolve correctly.

Availability checks query both calendars and treat a slot as busy if *either*
conflicts. Booking only ever writes to `GOOGLE_CALENDAR_ID`;
`GOOGLE_MAIN_CALENDAR_ID` is read-only and never modified.

Bookings appear in the transcript as a `📅 Booked: ...` line, so the Sheets log
is an audit trail of what got scheduled. Leave `GOOGLE_CALENDAR_ID` unset to
disable the feature entirely — the AI won't mention or offer scheduling.

Because calendar calls take a few seconds, the AI speaks a short filler ("One
moment, let me check the calendar") and does the real work on the next webhook,
so the caller isn't sitting in silence.

---

## Project structure

```
AICallAssistant/
├── index.js                 ← Entry point: config check, middleware, routes, server
├── lib/
│   ├── config.js            ← Startup validation of required env vars
│   ├── clients.js           ← Lazy Twilio/OpenAI clients, model and timezone resolution
│   ├── callStore.js         ← In-memory call state, initCall(), stale-call sweeper
│   ├── twiml.js             ← TwiML helpers (gather config, speak+gather, greeting)
│   ├── googleAuth.js        ← Shared Google service-account auth client
│   ├── webhookAuth.js       ← Twilio request-signature verification
│   └── dashboardAuth.js     ← HTTP Basic auth for the dashboard and its API
├── services/
│   ├── llm.js               ← LLM calls, tool-call loop, system prompt
│   ├── calendar.js          ← Calendar tools + execution (check / propose / confirm)
│   ├── callControl.js       ← end_call tool
│   ├── blocklist.js         ← Blocklist cache, validation, Sheets persistence
│   ├── sheets.js            ← Writes the call log
│   ├── callHistory.js       ← Reads the call log back for the dashboard
│   ├── notify.js            ← SMS to you on a new call, booking confirmation to the caller
│   └── takeover.js          ← Keypress and dashboard handoff
├── routes/
│   ├── voice.js             ← Call-flow webhooks (/incoming-call, /respond, ...)
│   ├── callStatus.js        ← /call-status, /after-transfer
│   └── dashboard.js         ← /api/calls, /api/takeover, /api/blocklist
├── public/
│   ├── dashboard.html       ← Live call monitor UI
│   └── dashboard.css        ← Dashboard styling
├── test/                    ← Unit tests (node:test, no network)
└── .env.example             ← Documented template for every variable
```

### API routes

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/incoming-call` | Twilio signature | A call arrives. Blocklist check, then rings your phone |
| `POST` | `/owner-no-answer` | Twilio signature | Result of ringing your phone. Starts the AI, or closes out the call if you answered |
| `POST` | `/respond` | Twilio signature | One caller turn: speech or a keypress |
| `POST` | `/continue-tools` | Twilio signature | Runs queued calendar work after the "one moment" filler |
| `POST` | `/silence` | Twilio signature | Caller said nothing. Nudges them |
| `POST` | `/call-status` | Twilio signature | Call ended. Moves to history, logs to Sheets |
| `POST` | `/after-transfer` | Twilio signature | A transfer finished, or failed and returns the caller to the AI |
| `GET` | `/healthz` | public | Liveness probe, for uptime pingers |
| `GET` | `/dashboard.html` | Basic auth | Live call monitor UI |
| `GET` | `/api/calls` | Basic auth | Active and recent calls. Polled every 2s |
| `GET` | `/api/calls/history` | Basic auth | Older calls, read back from the Sheets log |
| `POST` | `/api/takeover` | Basic auth | Transfers a live call to you |
| `GET` | `/api/blocklist` | Basic auth | Current blocked numbers |
| `POST` | `/api/blocklist` | Basic auth | Block a number (`{ number, reason }`) |
| `POST` | `/api/blocklist/remove` | Basic auth | Unblock a number (`{ number }`) |

Every voice webhook verifies Twilio's `X-Twilio-Signature` and rejects anything
unsigned or mis-signed. Every dashboard route requires credentials. Both fail
closed.

---

## Customization

### Quick reference

| What to change | Where |
| --- | --- |
| What the agent knows about you | `MY_INFO` env var |
| Your name | `MY_NAME` env var |
| How long your phone rings first | `OWNER_RING_TIMEOUT_SECONDS` env var |
| Takeover callback number | `OWNER_PHONE_NUMBER` env var |
| Which AI model is used | `LLM_MODEL` env var |
| Dashboard login | `DASHBOARD_USER` / `DASHBOARD_PASSWORD` env vars |
| Agent's voice | `voice:` in each `twiml.say()` — `lib/twiml.js`, `routes/voice.js`, `services/takeover.js` |
| Speech recognition quality | `gatherOptions()` in `lib/twiml.js` |
| Agent's behaviour rules | `systemPrompt()` in `services/llm.js` |

### The agent's voice

```js
voice: 'Polly.Matthew-Neural'   // default — American male
voice: 'Polly.Joanna-Neural'    // American female
voice: 'Polly.Brian-Neural'     // British male
voice: 'Polly.Amy-Neural'       // British female
```

### Speech recognition accuracy

Every `twiml.gather()` shares one config in `gatherOptions()` (`lib/twiml.js`),
so changing it updates every turn at once:

```js
speechModel: 'googlev2_telephony',
enhanced:    true,
```

`googlev2_telephony` is Google's STT tuned for phone audio. It trades Twilio's
automatic failover to another provider during an outage for accuracy on
telephony specifically. Alternatives: `experimental_conversations` (Twilio's own,
with failover) or `deepgram_nova-2` / `deepgram_nova-3`.

### How long the AI waits before assuming the caller is done

Also in `gatherOptions()`:

```js
speechTimeout: 2,   // seconds of silence before Twilio stops listening
```

Raise it if callers get cut off mid-sentence; lower it if replies feel sluggish.
**Avoid `'auto'`** — per Twilio's docs it stops at the *first* pause in speech,
which is exactly what causes premature cutoffs.

### The model

Set `LLM_MODEL`. Any OpenAI-compatible chat model with tool-calling support
works. Models without reliable tool calling will break appointment booking.

### Agent behaviour rules

Add to the rule list in `systemPrompt()` (`services/llm.js`):

```js
`- Always ask for the caller's name at the start of the conversation.\n`
`- If the caller says they are a recruiter, prioritise getting their email.\n`
```

### Call forwarding

You don't need carrier forwarding. The app rings `OWNER_PERSONAL_NUMBER` first,
so handing out your Twilio number directly is the simplest, most reliable setup.

If you do want calls to your personal number to reach the agent, most carriers
support conditional-forwarding dial codes (commonly `*004*<number>#` to enable,
`##004#` to disable, `*#004#` to check) — but the exact codes and reliability
vary by carrier, and forwarding loops are a common headache. Using a separate
number for `OWNER_PHONE_NUMBER` avoids the callback being forwarded straight
back to Twilio.

### Deploying a change

```bash
git add . && git commit -m "describe what you changed" && git push
```

Render detects the push and redeploys in ~2 minutes. Worth running `npm test`
first.

---

## Development

Run with auto-restart on file changes:

```bash
npm run dev
```

Run the tests:

```bash
npm test
```

The suite covers the pure logic: phone-number normalisation and validation,
duration capping, transcript parsing, config validation, the call-store sweeper,
and both auth middlewares (including a real Twilio signature round-trip).
Nothing touches the network by design, so `npm test` needs no credentials. CI
runs it on Node 20 and 22, plus a check that the app refuses to start
unconfigured.

Notes for deploying anywhere:

- **HTTPS is required.** Basic auth credentials and Twilio signatures are both
  meaningless over plaintext HTTP.
- **Run a single instance.** Call state and the blocklist live in process
  memory. Scaling to more than one replica will break calls mid-conversation.
  See [SECURITY.md](SECURITY.md#known-limitations).

---

## Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| App exits with "Missing required configuration" | A required variable isn't set | It lists exactly which ones |
| `Rejected webhook with invalid signature` in logs | `BASE_URL` doesn't match the URL Twilio called | Fix `BASE_URL` — exact match, no trailing slash, `https://` |
| "An application error has occurred" when calling | `BASE_URL` wrong, or the app is asleep | Check `BASE_URL` and your uptime monitor |
| Dashboard returns 503 "disabled" | `DASHBOARD_USER` / `DASHBOARD_PASSWORD` not set | Set both and redeploy |
| Dashboard keeps asking for a password | Wrong credentials, or you're on HTTP | Check the values; make sure you're on HTTPS |
| AI doesn't speak — caller hears silence | App crashed on startup | Check host logs for red lines, usually a missing or malformed env var |
| App sleeps between calls | Uptime monitor missing or pointed at the wrong URL | Point it at `/healthz` every 5 minutes |
| Calls stay "live" after the caller hangs up | `/call-status` webhook not configured | Add it in the Twilio console |
| Google Sheets not logging | Sheet not shared, or malformed credentials | Share as **Editor** with the service-account email; check `GOOGLE_CREDENTIALS_JSON` is one line with no breaks |
| Take Over button does nothing | The call already ended | It only works during active calls — check host logs for the error |
| Takeover loops back to the AI | `OWNER_PHONE_NUMBER` forwards back to Twilio | Use a separate number (e.g. Google Voice) |
| AI mishears names | STT model mismatch | Try a different `speechModel` in `gatherOptions()` |
| SMS alert not arriving | `OWNER_PHONE_NUMBER` wrong or malformed | Check it's E.164, with the `+1` prefix |
| Booking never happens | Callers are saying "yes" instead of pressing 1 | Working as designed — see Calendar booking |
| Calendar tool errors | Booking calendar not shared with the service account | Share it at "Make changes to events" |

---

## Feedback

Bug reports are welcome via
[GitHub issues](https://github.com/Harsh1852/AICallAssistant/issues).

For anything security-related, please **don't** open a public issue — use
GitHub's private vulnerability reporting instead. See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). You're free to use, modify, and self-host this,
commercially or otherwise. It comes with no warranty: you are responsible for
your own deployment, your Twilio bill, and complying with call-recording and
privacy law where you are.
