const { twilioClient } = require('../lib/clients');
const { base } = require('../lib/twiml');

async function notifyOwner(callSid, callerNumber) {
  if (!process.env.OWNER_PHONE_NUMBER || !process.env.TWILIO_PHONE_NUMBER) return;
  const dashUrl = `${base()}/dashboard.html?sid=${callSid}`;
  await twilioClient().messages.create({
    to:   process.env.OWNER_PHONE_NUMBER,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: `📞 Incoming call from ${callerNumber}\nWatch live + take over:\n${dashUrl}`,
  });
  console.log(`📱 SMS sent to owner`);
}

// Texts the caller their booking confirmation (+ Meet link if one was
// created) right after a successful confirm_appointment — sent immediately
// rather than scheduled closer to the appointment, since this app has no
// persistent job scheduler to delay it.
async function sendMeetingLink(callerNumber, { purpose, date, startTime, meetLink }) {
  if (!process.env.TWILIO_PHONE_NUMBER || !callerNumber || callerNumber === 'unknown') return;
  const body =
    `Your appointment with ${process.env.MY_NAME} is confirmed:\n` +
    `${purpose}\n${date} at ${startTime}` +
    (meetLink ? `\n\nJoin here: ${meetLink}` : '');
  await twilioClient().messages.create({
    to:   callerNumber,
    from: process.env.TWILIO_PHONE_NUMBER,
    body,
  });
  console.log(`📱 Sent meeting confirmation to caller ${callerNumber}`);
}

module.exports = { notifyOwner, sendMeetingLink };
