// activeCalls: calls currently in progress (AI-handled only)
// endedCalls:  calls that have finished (kept for 2 hours for review)
const activeCalls = {};
const endedCalls  = {};

// How long a finished call stays in memory for the dashboard's "Recent calls"
// list. services/callHistory.js reads the same window from the other side —
// it only surfaces sheet rows OLDER than this — so a call that's still shown
// live doesn't also appear in the history view.
const ENDED_CALL_TTL_MS = 2 * 60 * 60 * 1000;

function initCall(callerNumber) {
  return {
    callerNumber,
    history:            [],
    transcript:         [],
    startTime:          new Date(),
    endTime:            null,
    status:             'active',
    outcome:            null,
    turnCount:          0,
    pendingAppointment: null,
    pendingToolCall:    null,
    // Caches check_availability/propose_appointment results within this call
    // so a redundant repeat check (same date/time/duration) doesn't hit the
    // Calendar API again — cleared whenever a booking succeeds, since that
    // can change availability for other slots on the same day.
    calendarCache:      {},
    // Set by the end_call tool when the model decides the conversation is
    // naturally over; checked after the reply is generated so the route can
    // hang up instead of reopening a Gather.
    endCallRequested:   false,
  };
}

// An active call whose /call-status callback never arrives (a misconfigured
// webhook, a delivery failure) would otherwise sit in activeCalls forever,
// holding its full transcript. No real call runs for hours, so anything past
// this is treated as abandoned and swept into the ended store so it is still
// logged and visible rather than silently dropped.
const STALE_ACTIVE_CALL_MS = 4 * 60 * 60 * 1000;

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function sweepCalls(onStale) {
  const now = Date.now();

  const staleCutoff = now - STALE_ACTIVE_CALL_MS;
  for (const [sid, c] of Object.entries(activeCalls)) {
    if (c.startTime && c.startTime.getTime() < staleCutoff) {
      c.status  = 'ended';
      c.outcome = c.outcome || 'abandoned';
      c.endTime = new Date();
      c.transcript.push({ speaker: 'System', text: 'Call closed automatically — no end-of-call callback received.' });
      endedCalls[sid] = c;
      delete activeCalls[sid];
      console.warn(`🧹 Swept stale active call ${sid} (${c.callerNumber})`);
      if (onStale) onStale(c);
    }
  }

  const endedCutoff = now - ENDED_CALL_TTL_MS;
  for (const [sid, c] of Object.entries(endedCalls)) {
    if (c.endTime && c.endTime.getTime() < endedCutoff) delete endedCalls[sid];
  }
}

// Started explicitly from index.js — see the note in services/blocklist.js
// about import-time side effects.
function startCallStoreSweeper(onStale) {
  const timer = setInterval(() => sweepCalls(onStale), SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = {
  activeCalls,
  endedCalls,
  initCall,
  sweepCalls,
  startCallStoreSweeper,
  ENDED_CALL_TTL_MS,
  STALE_ACTIVE_CALL_MS,
};
