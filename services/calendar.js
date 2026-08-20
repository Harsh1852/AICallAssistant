const { google } = require('googleapis');
const { timezone } = require('../lib/clients');
const { googleAuthClient } = require('../lib/googleAuth');

function calendarEnabled() {
  return Boolean(process.env.GOOGLE_CALENDAR_ID && process.env.GOOGLE_CREDENTIALS_JSON);
}

const DEFAULT_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES     = 45;

// Defaults to 30 minutes if unset/invalid, caps at 45 regardless of what the
// caller (or a misbehaving model) asks for.
function resolveDuration(durationMinutes) {
  const parsed = parseInt(durationMinutes, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DURATION_MINUTES;
  return Math.min(parsed, MAX_DURATION_MINUTES);
}

function calendarTools() {
  if (!calendarEnabled()) return [];

  const appointmentFields = {
    date:            { type: 'string', description: 'Date in YYYY-MM-DD format' },
    startTime:       { type: 'string', description: 'Start time in 24-hour HH:MM format' },
    // Declared as a string, not a number: some providers (observed with Groq's
    // Llama 3.3) occasionally emit numeric-looking strings for "number" fields,
    // which fails strict server-side schema validation before we ever see the
    // request. Our arithmetic on this field already tolerates a string fine.
    durationMinutes: { type: 'string', description: 'Length of the appointment in minutes, as a number e.g. "30". Optional — defaults to 30 minutes if the caller doesn\'t specify one. Maximum 45 minutes; longer requests are capped at 45.' },
    // Used verbatim as both the calendar event's title and description — a
    // single source of truth instead of trusting the model to keep a
    // separate title and notes field in sync with each other.
    purpose:         { type: 'string', description: "The specific, concrete reason for the appointment — e.g. 'Follow-up interview for the backend engineer role at Northwind' or 'Quote for kitchen cabinet installation'. Must NOT be vague (e.g. never 'wants to talk', 'general inquiry', 'personal matter') — if the caller hasn't said what the appointment is actually about, ask before proposing one." },
    callerName:      { type: 'string' },
    callerPhone:     { type: 'string' },
  };

  return [
    {
      type: 'function',
      function: {
        name:        'check_availability',
        description: `Check whether a specific date/time slot is free on ${process.env.MY_NAME}'s calendar, without proposing or booking anything. Useful for answering "are you free on..." questions.`,
        parameters: {
          type: 'object',
          properties: {
            date:            appointmentFields.date,
            startTime:       appointmentFields.startTime,
            durationMinutes: appointmentFields.durationMinutes,
          },
          required: ['date', 'startTime'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name:        'propose_appointment',
        description: `Step 1 of booking. Checks availability and holds a tentative slot for the caller to confirm. Requires a clear, specific purpose — do not call this until you know exactly what the appointment is for. This does NOT book the appointment — the caller must press 1 on their phone keypad to actually confirm it; there is no way to confirm by voice.`,
        parameters: {
          type:       'object',
          properties: appointmentFields,
          required:   ['date', 'startTime', 'purpose', 'callerName'],
        },
      },
    },
    // confirm_appointment is intentionally NOT exposed as a callable tool here.
    // Booking is only ever confirmed by the caller pressing 1 on their keypad,
    // handled directly in routes/voice.js — bypassing the LLM/speech path
    // entirely so a booking can never happen from a misheard "yes".
    // runCalendarTool still implements 'confirm_appointment' for that digit
    // handler to call directly.
  ];
}

async function getCalendarClient() {
  const auth = googleAuthClient();
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

// Checks the booking calendar plus (if configured) a separate main/personal
// calendar for conflicts. GOOGLE_MAIN_CALENDAR_ID only needs to be shared with
// the service account at "See only free/busy" — that reveals busy blocks
// without exposing event titles/details, and events are still only ever
// written to GOOGLE_CALENDAR_ID.
async function checkFreeBusy(calendar, start, end) {
  const calendarIds = [process.env.GOOGLE_CALENDAR_ID];
  if (process.env.GOOGLE_MAIN_CALENDAR_ID) calendarIds.push(process.env.GOOGLE_MAIN_CALENDAR_ID);

  const resp = await calendar.freebusy.query({
    requestBody: {
      timeMin:  start.toISOString(),
      timeMax:  end.toISOString(),
      timeZone: timezone(),
      items:    calendarIds.map(id => ({ id })),
    },
  });

  let busy = [];
  for (const id of calendarIds) {
    const entry = resp.data.calendars[id];
    if (entry?.errors) {
      console.error(`Freebusy error for calendar ${id}:`, entry.errors);
      // The booking calendar (GOOGLE_CALENDAR_ID) is load-bearing — if we
      // can't see it, we genuinely don't know if a slot is free, so this must
      // not be treated as "no conflicts found". GOOGLE_MAIN_CALENDAR_ID is a
      // best-effort extra check, so skip it on error rather than fail the tool.
      if (id === process.env.GOOGLE_CALENDAR_ID) {
        throw new Error(`Cannot access booking calendar (${id}) — check it is shared with the service account.`);
      }
      continue;
    }
    busy = busy.concat(entry?.busy || []);
  }
  return busy;
}

async function runCalendarTool(name, args, { call, currentTurn }) {
  const calendar = await getCalendarClient();
  if (!calendar) return { error: 'Calendar is not configured.' };

  if (name === 'check_availability' || name === 'propose_appointment') {
    // Schema `required` only guarantees these fields are present, not that
    // they're meaningful — reject a blank/whitespace-only name or purpose
    // before spending an API call, instead of trusting the model not to send
    // a placeholder.
    if (name === 'propose_appointment') {
      if (!args.callerName?.trim()) {
        return { error: 'callerName is missing or empty — ask the caller for their name before proposing an appointment.' };
      }
      if (!args.purpose?.trim()) {
        return { error: 'purpose is missing or empty — ask the caller what the appointment is for before proposing one.' };
      }
    }

    const durationMinutes = resolveDuration(args.durationMinutes);
    const start = new Date(`${args.date}T${args.startTime}:00`);
    if (isNaN(start)) return { error: 'Invalid date/time.' };
    const end = new Date(start.getTime() + durationMinutes * 60000);

    // Reuse a cached result for the exact same slot instead of hitting the
    // Calendar API again — the model doesn't always follow instructions not
    // to re-check something it already asked about, so this is a hard
    // guarantee rather than a hope. Cleared whenever a booking succeeds.
    const cacheKey = `${args.date}|${args.startTime}|${durationMinutes}`;
    let busy = call.calendarCache[cacheKey];
    if (!busy) {
      busy = await checkFreeBusy(calendar, start, end);
      call.calendarCache[cacheKey] = busy;
    }
    const available = busy.length === 0;

    if (name === 'check_availability') {
      return { available, durationMinutes, conflicts: busy };
    }

    // propose_appointment
    if (!available) {
      return { proposed: false, available: false, durationMinutes, conflicts: busy };
    }
    // Store the resolved (defaulted/capped) duration, not the raw caller
    // input — confirm_appointment books whatever's in here, so this is what
    // actually enforces the 45-minute cap end-to-end.
    call.pendingAppointment = { ...args, durationMinutes, proposedTurn: currentTurn };
    return {
      proposed: true,
      available: true,
      date: args.date,
      startTime: args.startTime,
      durationMinutes,
      message: 'Slot is free and held tentatively. Tell the caller to press 1 on their phone keypad to confirm — you cannot book it yourself.',
    };
  }

  if (name === 'confirm_appointment') {
    const pending = call.pendingAppointment;
    if (!pending) {
      return { error: 'No appointment has been proposed yet. Call propose_appointment first.' };
    }
    if (pending.proposedTurn === currentTurn) {
      return { error: 'Cannot confirm in the same turn it was proposed — wait for the caller to verbally confirm first.' };
    }

    const start = new Date(`${pending.date}T${pending.startTime}:00`);
    const end   = new Date(start.getTime() + (pending.durationMinutes || 30) * 60000);

    // Re-check availability in case something else got booked since the proposal.
    const busy = await checkFreeBusy(calendar, start, end);
    if (busy.length > 0) {
      call.pendingAppointment = null;
      return { error: 'That slot is no longer available. Ask the caller for a different time.', conflicts: busy };
    }

    // The verified Twilio Caller ID (call.callerNumber), not just whatever
    // phone number the model captured via speech — that's optional and
    // error-prone (STT-transcribed digits), so it's noted separately only if
    // it's an actual alternate number.
    const altPhone = pending.callerPhone && pending.callerPhone !== call.callerNumber
      ? `\nAlternate number given: ${pending.callerPhone}`
      : '';

    // NOTE: auto-generating a Google Meet link (conferenceData) was tried and
    // confirmed NOT to work for this setup — Google rejects it ("Invalid
    // conference type value") for a personal-Gmail calendar managed by a bare
    // service account; that capability generally requires Google Workspace.
    // Not attempting it here since it would just fail on every booking.
    const event = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: pending.purpose,
        description:
          `${pending.purpose}\n\n` +
          `Booked via AI phone assistant.\n` +
          `Caller: ${pending.callerName}\n` +
          `Phone (Caller ID): ${call.callerNumber}${altPhone}`,
        start: { dateTime: start.toISOString(), timeZone: timezone() },
        end:   { dateTime: end.toISOString(),   timeZone: timezone() },
      },
    });

    call.pendingAppointment = null;
    call.calendarCache = {}; // this booking may affect availability for other slots that were cached earlier
    return {
      success:         true,
      eventId:         event.data.id,
      purpose:         pending.purpose,
      date:            pending.date,
      startTime:       pending.startTime,
      durationMinutes: pending.durationMinutes,
    };
  }

  return { error: 'Unknown tool.' };
}

module.exports = { calendarEnabled, calendarTools, runCalendarTool };

// Exported for unit tests only — see the note in services/callHistory.js.
module.exports.__testables = { resolveDuration, DEFAULT_DURATION_MINUTES, MAX_DURATION_MINUTES };
