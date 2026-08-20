const twilio = require('twilio');
const { twilioClient } = require('../lib/clients');
const { base } = require('../lib/twiml');
const { activeCalls, endedCalls } = require('../lib/callStore');

// How long to let the owner's phone ring before giving up. Kept short
// deliberately — most carriers only forward to voicemail after ~20-30s /
// several rings, so a shorter timeout reliably triggers a 'no-answer'
// DialCallStatus (caught by /after-transfer) instead of the caller ending up
// on the owner's personal voicemail. logToSheets happens once the outcome is
// actually known, in /after-transfer, not here.
const TRANSFER_RING_TIMEOUT = 15;

// ── Takeover via keypress (caller pressed 0) ─────────────────────────────────
function doTakeover(callSid, call, res) {
  call.status  = 'taken-over';
  call.outcome = 'taken-over';
  call.endTime = new Date();

  console.log(`✅ Takeover via keypress for ${call.callerNumber}`);

  const handoff = `Okay, connecting you directly to ${process.env.MY_NAME} now.`;

  call.transcript.push({ speaker: 'AI', text: handoff });

  endedCalls[callSid] = { ...call };
  delete activeCalls[callSid];

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Matthew-Neural' }, handoff);
  const dial = twiml.dial({
    action:  `${base()}/after-transfer?sid=${callSid}`,
    method:  'POST',
    timeout: TRANSFER_RING_TIMEOUT,
  });
  dial.number(process.env.OWNER_PHONE_NUMBER);

  res.type('text/xml').send(twiml.toString());
}

// ── Takeover via dashboard button ────────────────────────────────────────────
async function doTakeoverApi(callSid, call) {
  call.status  = 'taken-over';
  call.outcome = 'taken-over';
  call.endTime = new Date();

  console.log(`✅ Takeover via dashboard for ${call.callerNumber}`);

  const handoff =
    `${process.env.MY_NAME} is available to take the call now. ` +
    `I am connecting you directly to ${process.env.MY_NAME}.`;

  call.transcript.push({ speaker: 'AI', text: handoff });

  endedCalls[callSid] = { ...call };
  delete activeCalls[callSid];

  // Built with VoiceResponse rather than concatenated XML: MY_NAME flows into
  // the <Say> text, and a bare '&' or '<' in it would produce invalid XML and
  // a silently failed takeover. The builder escapes for us.
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Matthew-Neural' }, handoff);
  const dial = twiml.dial({
    action:  `${base()}/after-transfer?sid=${callSid}`,
    method:  'POST',
    timeout: TRANSFER_RING_TIMEOUT,
  });
  dial.number(process.env.OWNER_PHONE_NUMBER);

  await twilioClient().calls(callSid).update({ twiml: twiml.toString() });
}

module.exports = { doTakeover, doTakeoverApi };
