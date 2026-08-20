const express = require('express');
const twilio  = require('twilio');
const router  = express.Router();

const { activeCalls, endedCalls, initCall } = require('../lib/callStore');
const { base, gatherOptions, speakAndGather, speakAndHangup, toolFillerPhrase, buildAIGreeting } = require('../lib/twiml');
const { openaiClient, model } = require('../lib/clients');
const { notifyOwner, sendMeetingLink } = require('../services/notify');
const { doTakeover } = require('../services/takeover');
const { calendarTools, runCalendarTool } = require('../services/calendar');
const { callControlTools } = require('../services/callControl');
const { callLLM, resolveAiReply } = require('../services/llm');
const { isBlocked } = require('../services/blocklist');
const { logToSheets } = require('../services/sheets');
const { validateTwilioRequest } = require('../lib/webhookAuth');

// Every route here is reached only by Twilio hitting a webhook. Paths are
// listed explicitly rather than using a bare router.use(): this router is
// mounted at '/', so an unscoped middleware would also reject dashboard
// requests on their way to the router registered after this one.
router.use(
  ['/incoming-call', '/owner-no-answer', '/respond', '/continue-tools', '/silence'],
  validateTwilioRequest,
);

// How long the owner's own phone rings before the AI takes the call. Short by
// default so the caller isn't left listening to ringing, but worth raising if
// you actually want a chance to pick up.
const OWNER_RING_TIMEOUT = Number(process.env.OWNER_RING_TIMEOUT_SECONDS) || 10;

// Tools whose execution involves a real Calendar API round-trip — only these
// warrant the "one moment" filler + /continue-tools redirect. end_call is
// instant (just sets a flag), so it should never trigger that detour.
const SLOW_TOOL_NAMES = ['check_availability', 'propose_appointment'];

function speakFinalReply(res, callSid, call, aiReply) {
  if (call.endCallRequested) {
    return speakAndHangup(res, aiReply);
  }
  speakAndGather(res, callSid, aiReply);
}

// ── ROUTE 1: Incoming call ───────────────────────────────────────────────────
router.post('/incoming-call', (req, res) => {
  const callSid      = req.body.CallSid;
  const callerNumber = req.body.From || 'unknown';

  console.log(`📞 Incoming call from ${callerNumber}  SID: ${callSid}`);

  if (isBlocked(callerNumber)) {
    console.log(`🚫 Blocked call from ${callerNumber}`);
    // Record it as an ended call (status 'blocked') so it's still visible on
    // the dashboard — otherwise a rejected call leaves no trace anywhere.
    const blockedCall = initCall(callerNumber);
    blockedCall.status   = 'blocked';
    blockedCall.outcome  = 'blocked';
    blockedCall.endTime  = new Date();
    blockedCall.transcript.push({ speaker: 'System', text: 'Call rejected — number is on the blocklist.' });
    endedCalls[callSid] = blockedCall;
    logToSheets(blockedCall, 'blocked').catch(console.error);
    // <Reject> declines before answering — no per-minute charge, no ring to
    // the owner, no AI engagement, unlike <Hangup> which requires answering first.
    return res.type('text/xml').send('<Response><Reject/></Response>');
  }

  const twiml = new twilio.twiml.VoiceResponse();

  if (process.env.OWNER_PERSONAL_NUMBER) {
    // Track the call from the moment it arrives, before the owner's phone is
    // even rung. Creating the record only once the AI took over meant a call
    // the owner answered personally left no trace anywhere — no Sheets row,
    // no dashboard entry — because /call-status found nothing to update.
    activeCalls[callSid] = initCall(callerNumber);

    // Ring owner's personal number first before handing to AI
    const dial = twiml.dial({
      timeout: OWNER_RING_TIMEOUT,
      action:  `${base()}/owner-no-answer?sid=${callSid}`,
      method:  'POST',
    });
    dial.number(process.env.OWNER_PERSONAL_NUMBER);
  } else {
    // No personal number configured — AI picks up immediately
    activeCalls[callSid] = initCall(callerNumber);
    notifyOwner(callSid, callerNumber).catch(console.error);
    buildAIGreeting(callSid, activeCalls[callSid], twiml);
  }

  res.type('text/xml').send(twiml.toString());
});

// ── ROUTE 1b: Result of ringing the owner's own phone ────────────────────────
router.post('/owner-no-answer', (req, res) => {
  const callSid      = req.query.sid;
  const dialStatus   = req.body.DialCallStatus;
  const callerNumber = req.body.From || 'unknown';

  // The record was created in /incoming-call; fall back in case this is hit
  // out of order (e.g. a replayed callback after a restart).
  const call = activeCalls[callSid] || initCall(callerNumber);
  activeCalls[callSid] = call;

  if (dialStatus === 'completed') {
    // Owner answered and the call ended normally. Close the record out here
    // rather than leaving it for /call-status: the AI never engaged, so there
    // is no transcript, but the call still belongs in the log.
    call.status  = 'ended';
    call.outcome = 'answered-by-owner';
    call.endTime = new Date();
    call.transcript.push({ speaker: 'System', text: 'Answered directly by owner — AI did not engage.' });

    endedCalls[callSid] = call;
    delete activeCalls[callSid];
    logToSheets(call, 'answered-by-owner').catch(console.error);

    return res.type('text/xml').send('<Response><Hangup/></Response>');
  }

  // Owner didn't pick up (no-answer, busy, failed, canceled) — hand off to AI
  console.log(`📵 Owner unavailable (${dialStatus}), AI picking up for ${callerNumber}`);
  notifyOwner(callSid, callerNumber).catch(console.error);

  const twiml = new twilio.twiml.VoiceResponse();
  buildAIGreeting(callSid, call, twiml);
  res.type('text/xml').send(twiml.toString());
});

// ── ROUTE 2: Caller spoke or pressed a key ───────────────────────────────────
router.post('/respond', async (req, res) => {
  const callSid = req.query.sid;
  const speech  = (req.body.SpeechResult || '').trim();
  const digit   = req.body.Digits || '';
  const call    = activeCalls[callSid];

  if (!call || call.status !== 'active') {
    return res.type('text/xml').send('<Response><Hangup/></Response>');
  }

  // Press 0 to request transfer to owner
  if (digit === '0' || digit === '*') {
    return doTakeover(callSid, call, res);
  }

  call.turnCount += 1;
  const currentTurn = call.turnCount;

  // Press 1 to confirm a pending appointment directly — bypasses the LLM so
  // confirmation doesn't depend on speech recognition catching a spoken "yes".
  if (digit === '1' && call.pendingAppointment) {
    let result;
    try {
      result = await runCalendarTool('confirm_appointment', {}, { call, currentTurn });
    } catch (err) {
      result = { error: err.message };
    }

    let aiReply;
    if (result.success) {
      // No Meet-link promise here — confirmed against the real Calendar API
      // that auto-generating one isn't supported for this account (see
      // services/calendar.js), so only promise what's actually sent.
      aiReply = `You're all set — booked for ${result.date} at ${result.startTime}. I'll text a confirmation to this number. Anything else I can help with?`;
      call.transcript.push({
        speaker: 'System',
        text:    `📅 Booked: ${result.purpose} on ${result.date} ${result.startTime} (${result.durationMinutes}m)`,
      });
      sendMeetingLink(call.callerNumber, result).catch(err => console.error('Booking confirmation SMS error:', err.message));
    } else {
      aiReply = `Sorry, I couldn't confirm that — ${result.error || 'something went wrong'}. Could you tell me the time again?`;
    }

    call.history.push({ role: 'assistant', content: aiReply });
    call.transcript.push({ speaker: 'AI', text: aiReply });
    console.log(`🤖 AI: ${aiReply}`);

    return speakAndGather(res, callSid, aiReply);
  }

  let aiReply = "I'm sorry, I didn't quite catch that — could you please say that again?";

  if (speech) {
    console.log(`🗣  Caller (${call.callerNumber}): ${speech}`);
    call.transcript.push({ speaker: 'Caller', text: speech });
    call.history.push({ role: 'user', content: speech });

    try {
      const tools = [...callControlTools(), ...calendarTools()];
      const message = await callLLM(call.history, tools);

      const hasSlowToolCall = message.tool_calls?.some(tc => SLOW_TOOL_NAMES.includes(tc.function.name));
      if (hasSlowToolCall) {
        // Calendar tool calls (+ any follow-up LLM hops) can take a few
        // seconds. Speak a quick filler now and do the slow work in the
        // follow-up request the redirect triggers, so the caller isn't just
        // sitting in dead air while we check. end_call is instant, so it
        // never needs this detour even if called alongside something else.
        call.pendingToolCall = { message, tools, currentTurn };
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({ voice: 'Polly.Matthew-Neural' }, toolFillerPhrase());
        twiml.redirect({ method: 'POST' }, `${base()}/continue-tools?sid=${callSid}`);
        return res.type('text/xml').send(twiml.toString());
      }

      aiReply = await resolveAiReply(call, message, tools, currentTurn);
    } catch (err) {
      console.error(`LLM error [model=${model()} baseURL=${openaiClient().baseURL} status=${err.status}]:`, err.message, err.error || '');
    }
  }

  speakFinalReply(res, callSid, call, aiReply);
});

// ── ROUTE 2b: Resumes after the "one moment" filler to run queued tool calls ──
router.post('/continue-tools', async (req, res) => {
  const callSid = req.query.sid;
  const call    = activeCalls[callSid];

  if (!call || call.status !== 'active' || !call.pendingToolCall) {
    return res.type('text/xml').send('<Response><Hangup/></Response>');
  }

  const { message, tools, currentTurn } = call.pendingToolCall;
  call.pendingToolCall = null;

  let aiReply = 'Sure, one moment.';
  try {
    aiReply = await resolveAiReply(call, message, tools, currentTurn);
  } catch (err) {
    console.error(`LLM error [model=${model()} baseURL=${openaiClient().baseURL} status=${err.status}]:`, err.message, err.error || '');
  }

  speakFinalReply(res, callSid, call, aiReply);
});

// ── ROUTE 3: No input fallback ───────────────────────────────────────────────
router.post('/silence', (req, res) => {
  const callSid = req.query.sid;
  const call    = activeCalls[callSid];

  if (!call || call.status !== 'active') {
    return res.type('text/xml').send('<Response><Hangup/></Response>');
  }

  const nudge =
    `Are you still there? Feel free to speak, or press 0 to try getting ` +
    `connected to ${process.env.MY_NAME} again.`;

  call.transcript.push({ speaker: 'AI', text: nudge });

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Matthew-Neural' }, nudge);
  twiml.gather(gatherOptions(callSid, 10));
  twiml.hangup();

  res.type('text/xml').send(twiml.toString());
});

module.exports = router;
