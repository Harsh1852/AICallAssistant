const { google } = require('googleapis');
const { googleAuthClient } = require('../lib/googleAuth');
const { ENDED_CALL_TTL_MS } = require('../lib/callStore');

// The read side of services/sheets.js. logToSheets appends one row per
// finished call, in this column order:
//   timestamp | caller | duration | outcome | turn count | transcript
// Reading it back is what gives the dashboard a call log that outlives the
// process — lib/callStore only holds finished calls in memory, and only for
// ENDED_CALL_TTL_MS.
const SHEET_RANGE = 'Sheet1!A:F';

// The sheet is append-only and grows forever, so cap what we hold in memory
// at the newest N rows. Bounding the request itself isn't possible without a
// second API call (Sheets ranges are positional, not date-based, so you'd
// have to read column A first just to learn the row count) — not worth it at
// current volume, and this whole module becomes a SQL query with LIMIT if
// the call log ever moves to a real datastore.
const MAX_ROWS = 2000;

// Sheets is slow and quota-limited, and this view is opened by hand rather
// than polled (unlike /api/calls), so a short cache is enough to keep paging
// and searching from re-fetching the entire sheet on every keystroke.
const CACHE_TTL_MS = 60 * 1000;
let cache = { at: 0, calls: null };

// Rows are written as "Speaker: text" joined by newlines.
const SPEAKER_LINE = /^(AI|Caller|System):\s?(.*)$/;

function parseDuration(raw) {
  const mins = /(\d+)\s*m/.exec(raw || '');
  const secs = /(\d+)\s*s/.exec(raw || '');
  return (mins ? Number(mins[1]) * 60 : 0) + (secs ? Number(secs[1]) : 0);
}

function parseTranscript(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    const m = SPEAKER_LINE.exec(line);
    if (m) {
      out.push({ speaker: m[1], text: m[2] });
    } else if (out.length) {
      // Entries are joined with newlines, so an utterance that itself
      // contained one arrives as a continuation line. Append it to the
      // previous message rather than dropping it.
      out[out.length - 1].text += '\n' + line;
    }
  }
  return out;
}

// Shapes a sheet row like the objects /api/calls returns, so the dashboard's
// existing card and transcript rendering works on history rows unchanged.
function parseRow(row, index) {
  const [ts, callerNumber, duration, outcome, , transcript] = row;

  // logToSheets never writes a header, but people often add one by hand — and
  // a half-written row is possible if an append was interrupted. Either way
  // the timestamp won't parse, which is a good enough filter for both.
  const endedAt = new Date(ts);
  if (isNaN(endedAt.getTime())) return null;

  const durationSecs = parseDuration(duration);
  const status = outcome === 'blocked' || outcome === 'taken-over' ? outcome : 'ended';

  return {
    // Sheet rows have no CallSid — the column was never logged. Row position
    // is stable for an append-only sheet, which is all the dashboard needs to
    // key selection off. A real datastore would hand back the actual sid.
    callSid:      `hist-${index}`,
    callerNumber: callerNumber || 'unknown',
    status,
    outcome:      outcome || 'ended',
    duration:     durationSecs,
    transcript:   parseTranscript(transcript),
    // The logged timestamp is when the call ended; back out the start so the
    // card's time reads the same way live cards do.
    startTime:    new Date(endedAt.getTime() - durationSecs * 1000).toISOString(),
    endTime:      endedAt.toISOString(),
    historical:   true,
  };
}

async function loadHistory() {
  if (cache.calls && Date.now() - cache.at < CACHE_TTL_MS) return cache.calls;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return null;

  const auth = googleAuthClient();
  if (!auth) return null;

  const sheets = google.sheets({ version: 'v4', auth });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range:         SHEET_RANGE,
  });

  const rows = resp.data.values || [];
  const calls = rows
    .map(parseRow)                                  // index must be the row's
    .filter(Boolean)                                // real sheet position, so
    .slice(-MAX_ROWS)                               // map before trimming
    .sort((a, b) => new Date(b.endTime) - new Date(a.endTime));

  cache = { at: Date.now(), calls };
  return calls;
}

// Only surfaces calls older than the in-memory retention window — anything
// newer is still in endedCalls and already showing under "Recent calls", and
// without a CallSid there's no reliable way to dedupe the two lists.
async function getCallHistory({ limit = 50, offset = 0, q = '' } = {}) {
  const all = await loadHistory();
  if (!all) return { calls: [], total: 0, hasMore: false, configured: false };

  const cutoff = Date.now() - ENDED_CALL_TTL_MS;
  let calls = all.filter(c => new Date(c.endTime).getTime() < cutoff);

  // Caller number only, matched on digits so "(555) 012" finds +15550123456.
  // A query with no digits in it can't match a number, so it matches nothing
  // rather than silently listing everything.
  if (q.trim()) {
    const needle = q.replace(/\D/g, '');
    calls = needle
      ? calls.filter(c => (c.callerNumber || '').replace(/\D/g, '').includes(needle))
      : [];
  }

  const total = calls.length;
  return {
    calls:      calls.slice(offset, offset + limit),
    total,
    hasMore:    offset + limit < total,
    configured: true,
  };
}

module.exports = { getCallHistory };

// Exported for unit tests only — these are the pure parsing helpers, kept off
// the main export surface so they don't read as part of the module's API.
module.exports.__testables = { parseDuration, parseTranscript, parseRow };
