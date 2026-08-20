const twilio = require('twilio');

function base() {
  return (process.env.BASE_URL || '').replace(/\/$/, '');
}

function gatherOptions(callSid, timeout = 8) {
  return {
    input:         'speech dtmf',
    action:        `${base()}/respond?sid=${callSid}`,
    // 'auto' stops recognition at the FIRST pause in speech (per Twilio's own
    // docs), which cuts callers off mid-sentence if they pause to think. A
    // fixed number of seconds of silence is more forgiving of natural pauses.
    speechTimeout: 2,
    numDigits:     1,
    method:        'POST',
    timeout,
    speechModel:   'googlev2_telephony', // Google STT tuned specifically for phone-call audio
    enhanced:      true,                 // uses Twilio's enhanced model (may be a no-op for provider-specific models)
  };
}

function speakAndGather(res, callSid, text) {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Matthew-Neural' }, text);
  twiml.gather(gatherOptions(callSid));
  twiml.redirect({ method: 'POST' }, `${base()}/silence?sid=${callSid}`);
  res.type('text/xml').send(twiml.toString());
}

// Used when the model has called end_call — speaks the closing reply and
// hangs up instead of reopening a Gather. Twilio still fires /call-status
// afterward just like any other call ending, so the usual ended-call
// bookkeeping (Sheets logging, moving to endedCalls) happens automatically.
function speakAndHangup(res, text) {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Matthew-Neural' }, text);
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
}

// confirm_appointment isn't exposed as a model-callable tool (only the
// press-1 digit handler can confirm a booking), so any tool call reaching
// here is always a calendar check, never a booking.
function toolFillerPhrase() {
  return "One moment, let me check the calendar.";
}

function buildAIGreeting(callSid, call, twiml) {
  const greeting =
    `Hi! This is ${process.env.MY_NAME}'s AI assistant. ` +
    `${process.env.MY_NAME} isn't available right now, but I can take a message ` +
    `or answer questions as best I can. How can I help you today?`;

  call.transcript.push({ speaker: 'AI', text: greeting });
  call.history.push({ role: 'assistant', content: greeting });

  twiml.say({ voice: 'Polly.Matthew-Neural' }, greeting);
  twiml.gather(gatherOptions(callSid));
  twiml.redirect({ method: 'POST' }, `${base()}/silence?sid=${callSid}`);
}

module.exports = { base, gatherOptions, speakAndGather, speakAndHangup, toolFillerPhrase, buildAIGreeting };
