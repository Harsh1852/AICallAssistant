// Fails fast with an actionable message instead of letting a missing variable
// surface later as an opaque SDK constructor error ("The OPENAI_API_KEY
// environment variable is missing") or, worse, as a call that answers and
// then breaks halfway through.

const REQUIRED = [
  ['TWILIO_ACCOUNT_SID',  'Twilio Console → Account Info'],
  ['TWILIO_AUTH_TOKEN',   'Twilio Console → Account Info'],
  ['TWILIO_PHONE_NUMBER', 'Your Twilio number in E.164 format, e.g. +15551234567'],
  ['BASE_URL',            'Public HTTPS URL of this app, e.g. https://your-app.onrender.com'],
  ['MY_NAME',             'The name the assistant answers on behalf of'],
  ['MY_INFO',             'What the assistant is allowed to say about you'],
];

// Values still carrying the shape of a .env.example placeholder. Copying the
// example to .env and starting the app would otherwise "succeed" — every
// required variable is non-empty, so the check passed and printed the usual
// startup banner — while the credentials were fake and every real call would
// fail. Worse, the dashboard would come up on the example's shared password.
// Treating these as unset turns a confusing runtime failure into a startup
// error naming the variable.
const PLACEHOLDER = /xxxx|your_|your-app|change_me|placeholder|_here\b/i;

// Checked even though it isn't in REQUIRED: the dashboard is optional, but
// running it on a password published in this repo is worse than not running it.
const PLACEHOLDER_CHECKED_OPTIONAL = [
  ['DASHBOARD_PASSWORD', 'Set a long random password, not the one from .env.example'],
];

function isPlaceholder(value) {
  return PLACEHOLDER.test(String(value || ''));
}

function missingRequired() {
  return REQUIRED.filter(([key]) => !process.env[key]?.trim());
}

// Reported separately from "missing" so the error can say *why* the value was
// rejected — "still set to the example placeholder" is a much faster fix than
// "missing" when the variable visibly has something in it.
function placeholderValued() {
  const checked = [...REQUIRED, ...PLACEHOLDER_CHECKED_OPTIONAL];
  return checked.filter(([key]) => {
    const value = process.env[key]?.trim();
    return value && isPlaceholder(value);
  });
}

// Either provider works; the app picks Groq first when both are present. A key
// that is present but still a placeholder counts as absent.
function realLlmKey(name) {
  const value = process.env[name]?.trim();
  return value && !isPlaceholder(value) ? value : null;
}

function missingLlmKey() {
  return !realLlmKey('GROQ_API_KEY') && !realLlmKey('OPENAI_API_KEY');
}

function assertConfig() {
  const problems = missingRequired().map(([key, hint]) => `  ${key} — ${hint}`);

  if (missingLlmKey()) {
    problems.push('  GROQ_API_KEY or OPENAI_API_KEY — at least one real LLM provider key is required');
  }

  const placeholders = placeholderValued().map(
    ([key, hint]) => `  ${key} — still set to the .env.example placeholder. ${hint}`,
  );

  if (!problems.length && !placeholders.length) return;

  if (problems.length) {
    console.error('\n⛔ Missing required configuration:\n');
    console.error(problems.join('\n'));
  }

  if (placeholders.length) {
    console.error('\n⛔ Placeholder values still in place:\n');
    console.error(placeholders.join('\n'));
  }

  console.error('\nCopy .env.example to .env and fill these in with your real values');
  console.error('(or set them in your host\'s environment settings).');
  console.error('See README.md → Configuration.\n');
  process.exit(1);
}

module.exports = {
  assertConfig,
  missingRequired,
  missingLlmKey,
  placeholderValued,
  isPlaceholder,
  REQUIRED,
};
