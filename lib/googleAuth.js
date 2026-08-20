const { google } = require('googleapis');

// Shared by the calendar and Sheets services — one auth client, one set of
// scopes. Actual access is still gated per-resource by Google's own sharing
// (a calendar or sheet must be explicitly shared with this service account),
// not by which scopes are requested here.
function googleAuthClient() {
  const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!credsRaw) return null;
  const credentials = JSON.parse(credsRaw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar',
    ],
  });
}

module.exports = { googleAuthClient };
