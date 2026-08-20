const { openaiClient, model, timezone } = require('../lib/clients');
const { calendarEnabled, runCalendarTool } = require('./calendar');
const { runCallControlTool } = require('./callControl');

function dispatchTool(name, args, ctx) {
  if (name === 'end_call') return runCallControlTool(name, args, ctx);
  return runCalendarTool(name, args, ctx);
}

// ── LLM call helper ────────────────────────────────────────────────────────────
async function callLLM(history, tools, toolChoice = 'auto') {
  const completion = await openaiClient().chat.completions.create({
    model:       model(),
    max_tokens:  350, // Reasoning models spend part of this budget on internal thinking; 200 was cutting replies off mid-sentence after a tool call.
    temperature: 0.55,
    messages: [
      { role: 'system', content: systemPrompt() },
      ...history,
    ],
    ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
  });
  return completion.choices[0].message;
}

// Takes the model's current response (which may or may not have tool_calls
// pending), executes any tool calls and loops until it gets a final spoken
// reply, then records that reply on the call. Shared by /respond (for the
// no-tool-calls fast path) and /continue-tools (which resumes after the
// "one moment" filler with the first round of tool calls already decided).
async function resolveAiReply(call, message, tools, currentTurn) {
  // Tool-calling loop: execute any calendar tool calls and feed results back
  // to the model until it produces a final spoken reply (max 3 hops to guard
  // against a runaway loop).
  let hops = 0;
  while (message.tool_calls && message.tool_calls.length && hops < 3) {
    call.history.push({
      role:       'assistant',
      content:    message.content || null,
      tool_calls: message.tool_calls,
    });

    for (const tc of message.tool_calls) {
      // `|| '{}'` only covers a missing/empty string; some providers send the
      // literal string "null" for a tool call with no parameters, which
      // JSON.parse turns into an actual null rather than an empty object.
      const args = JSON.parse(tc.function.arguments || '{}') || {};
      console.log(`🔧 Tool call: ${tc.function.name}(${tc.function.arguments})`);

      let result;
      try {
        result = await dispatchTool(tc.function.name, args, { call, currentTurn });
      } catch (err) {
        result = { error: err.message };
      }

      call.history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }

    message = await callLLM(call.history, tools);
    hops++;
  }

  let aiReply = (message.content || '').trim();

  // Some providers occasionally return empty content right after a tool
  // result instead of a spoken summary. Retry with tool_choice: 'none' — this
  // keeps the tool definitions in the request (so the tool_calls/tool
  // messages already in history stay consistent) while forbidding another
  // tool call, forcing a text answer. Dropping `tools` entirely here was
  // tried first and made it worse: the history still references tool calls
  // the request no longer describes, which the model can't reconcile.
  if (!aiReply) {
    console.log("⚠️  Empty content after tool call — retrying with tool_choice: 'none'");
    try {
      const finalMessage = await callLLM(call.history, tools, 'none');
      aiReply = (finalMessage.content || '').trim();
    } catch (err) {
      console.error('LLM retry error:', err.message);
    }
  }

  aiReply = aiReply || 'Sure, one moment.';
  call.history.push({ role: 'assistant', content: aiReply });
  call.transcript.push({ speaker: 'AI', text: aiReply });
  console.log(`🤖 AI: ${aiReply}`);
  return aiReply;
}

// ── System prompt ─────────────────────────────────────────────────────────────
function systemPrompt() {
  const tz = timezone();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD

  const calendarRule = calendarEnabled()
    ? `- You can propose appointments on ${process.env.MY_NAME}'s calendar by calling propose_appointment with the requested date/time — ` +
      `this checks availability but does NOT book anything. ` +
      `You must have BOTH the caller's real name AND the SPECIFIC purpose of the appointment (what they actually want to discuss) before calling ` +
      `propose_appointment — if either is missing, ask for it first. Never invent a placeholder name, and never propose or book with a vague ` +
      `purpose like "wants to talk" or "personal matter" — ask what specifically they want to discuss. ` +
      `State the proposed date, time, and purpose back to the caller and tell them to press 1 on their phone keypad to confirm it. ` +
      `You have NO way to confirm or book an appointment yourself — there is no tool for it. Booking only happens when the caller presses 1. ` +
      `If the caller says "yes" or otherwise tries to confirm by voice, tell them you can't book it that way and remind them to press 1. ` +
      `If the caller changes the date/time/purpose, call propose_appointment again with the new details. ` +
      `Appointments default to 30 minutes if the caller doesn't specify a length, and the maximum is 45 minutes — ` +
      `if they ask for something longer, let them know 45 minutes is the max before proposing it. ` +
      `Before calling check_availability or propose_appointment, check the conversation history — if you already checked or proposed that exact ` +
      `date/time earlier in this call, reuse that earlier result instead of calling the tool again. Only re-check a date/time if the caller is ` +
      `asking about a different one, or after a booking succeeded (which can affect availability). ` +
      `Today's date is ${today} (timezone ${tz}) — resolve relative dates like "tomorrow" or "next Tuesday" against it.\n`
    : '';

  return (
    `You are an AI phone assistant answering calls on behalf of ${process.env.MY_NAME}.\n` +
    `About ${process.env.MY_NAME}: ${process.env.MY_INFO}\n\n` +
    `Rules:\n` +
    `- Never use markdown or any text formatting (no asterisks, bullet points, headers) — your reply is spoken aloud over the phone, not displayed as text.\n` +
    `- Keep every reply SHORT — 4 sentences maximum.\n` +
    `- Sound warm and natural, like a helpful human assistant.\n` +
    `- If asked whether you are human or AI, say you are an AI assistant for ${process.env.MY_NAME}.\n` +
    `- If the caller wants to speak to ${process.env.MY_NAME} directly, tell them to press 0.\n` +
    `- When taking a message, confirm the caller's name and message back to them.\n` +
    `- If you have any trouble catching the caller's name or message, confirm it with them again.\n` +
    `- Never invent facts about ${process.env.MY_NAME} that are not in the info above.\n` +
    `- Check the conversation history before you speak. Never re-ask a question the caller already answered, and never restate ` +
    `information you already gave them earlier in this same call — refer back to what was said instead of repeating it.\n` +
    `- When the caller says goodbye, indicates they have nothing else to discuss, or confirms a message/question is fully wrapped up, ` +
    `call end_call and give a brief closing reply — don't just keep the conversation open waiting for them to hang up themselves.\n` +
    calendarRule
  );
}

module.exports = { callLLM, resolveAiReply, systemPrompt };
