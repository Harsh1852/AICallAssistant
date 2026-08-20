const twilio = require('twilio');
const OpenAI = require('openai');

// Both SDKs validate credentials in their constructors and throw if a key is
// missing. Constructing them eagerly at import time therefore made every
// module that transitively required this file unimportable without a full
// environment — including unit tests for pure helpers that never touch the
// network. They are built on first use instead, and cached after that.
//
// index.js still validates configuration up front (lib/config.js), so a real
// server start fails fast with a readable message rather than lazily here.

let _twilioClient = null;
let _openai       = null;

function twilioClient() {
  if (!_twilioClient) {
    _twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _twilioClient;
}

// Groq is checked first: it exposes an OpenAI-compatible endpoint, so the same
// client works for both and only the baseURL and model name differ.
function usingGroq() {
  return Boolean(process.env.GROQ_API_KEY);
}

function openaiClient() {
  if (!_openai) {
    _openai = usingGroq()
      ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
      : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// Overridable so a fork can point at a different model without editing code.
function model() {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  return usingGroq() ? 'openai/gpt-oss-20b' : 'gpt-4o';
}

function timezone() {
  return process.env.TIMEZONE || 'America/Los_Angeles';
}

module.exports = { twilioClient, openaiClient, model, timezone, usingGroq };
