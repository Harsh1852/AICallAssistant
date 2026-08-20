// Call-ending is its own tool, separate from calendar.js, since it applies
// to every call regardless of whether calendar booking is configured.

function callControlTools() {
  return [
    {
      type: 'function',
      function: {
        name:        'end_call',
        description: `Call this when the conversation has reached a natural close — e.g. the caller says goodbye, indicates they have nothing else to discuss, or you've just finished taking a message/answering their question and they've confirmed that's everything. After calling this, give a brief, warm closing reply — it will be the last thing spoken before the call ends. Do not call this if the caller might still want to say something else or ask another question.`,
        parameters: { type: 'object', properties: {} },
      },
    },
  ];
}

function runCallControlTool(name, args, { call }) {
  if (name === 'end_call') {
    call.endCallRequested = true;
    return { ended: true, message: 'The call will end right after your next reply — say a brief, warm goodbye now.' };
  }
  return { error: 'Unknown tool.' };
}

module.exports = { callControlTools, runCallControlTool };
