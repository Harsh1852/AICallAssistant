const express = require('express');
const router  = express.Router();

const { activeCalls, endedCalls } = require('../lib/callStore');
const { logToSheets } = require('../services/sheets');
const { speakAndGather } = require('../lib/twiml');
const { validateTwilioRequest } = require('../lib/webhookAuth');

// Both routes here are Twilio callbacks. Scoped by path for the same reason
// as routes/voice.js — see the note there.
router.use(['/call-status', '/after-transfer'], validateTwilioRequest);

// ── ROUTE 4: Twilio call status callback ────────────────────────────────────
// Twilio hits this when a call ends for ANY reason (caller hangs up, network
// drop, timeout, etc.). This must be set in Twilio's console under "Call Status Changes".
router.post('/call-status', async (req, res) => {
  const callSid    = req.body.CallSid;
  const callStatus = req.body.CallStatus; // completed | failed | busy | no-answer

  const call = activeCalls[callSid];
  if (call && call.status !== 'taken-over') {
    console.log(`📴 Call ended — status: ${callStatus} — from ${call.callerNumber}`);
    call.status  = 'ended';
    call.outcome = callStatus;
    call.endTime = new Date();

    // Move to ended store so dashboard can still show it
    endedCalls[callSid] = { ...call };
    delete activeCalls[callSid];

    await logToSheets(call, callStatus).catch(console.error);
  }

  res.sendStatus(200);
});

// ── After transfer completes ─────────────────────────────────────────────────
// Twilio hits this once the <Dial> to the owner's number ends, whether it
// connected or not. DialCallStatus tells us which: 'completed' means the
// owner and caller actually talked and have since hung up, so there's
// nothing left to do. Anything else (no-answer, busy, failed, canceled —
// the timeout on the dial keeps this from turning into the owner's real
// voicemail picking up) means the owner was never reached, so the caller is
// handed back to the AI instead of just being dropped.
router.post('/after-transfer', (req, res) => {
  const callSid    = req.query.sid;
  const dialStatus = req.body.DialCallStatus;
  const call       = endedCalls[callSid];

  if (dialStatus === 'completed' || !call) {
    if (call) logToSheets(call, 'taken-over').catch(console.error);
    return res.type('text/xml').send('<Response><Hangup/></Response>');
  }

  console.log(`📵 Transfer to owner failed (${dialStatus}) — resuming AI for ${call.callerNumber}`);

  const fallback =
    `Sorry, I wasn't able to connect you to ${process.env.MY_NAME} right now. ` +
    `Is there anything I can help you with, or would you like to leave a message? ` +
    `Otherwise, feel free to just hang up.`;

  call.status  = 'active';
  call.outcome = null;
  call.endTime = null;
  call.transcript.push({ speaker: 'AI', text: fallback });
  call.history.push({ role: 'assistant', content: fallback });

  activeCalls[callSid] = call;
  delete endedCalls[callSid];

  speakAndGather(res, callSid, fallback);
});

module.exports = router;
