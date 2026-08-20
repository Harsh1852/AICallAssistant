const { google } = require('googleapis');
const { timezone } = require('../lib/clients');
const { googleAuthClient } = require('../lib/googleAuth');

async function logToSheets(call, outcome) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return;

  try {
    const auth = googleAuthClient();
    if (!auth) return;
    const sheets = google.sheets({ version: 'v4', auth });

    const duration   = Math.floor((call.endTime - call.startTime) / 1000);
    const mins       = Math.floor(duration / 60);
    const secs       = duration % 60;
    const ts         = new Date().toLocaleString('en-US', { timeZone: timezone() });
    const transcript = call.transcript.map(t => `${t.speaker}: ${t.text}`).join('\n');

    await sheets.spreadsheets.values.append({
      spreadsheetId:   sheetId,
      range:           'Sheet1!A:F',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[ts, call.callerNumber, `${mins}m ${secs}s`, outcome, call.transcript.length, transcript]],
      },
    });
    console.log(`📊 Logged to Google Sheets`);
  } catch (err) {
    console.error('Sheets error:', err.message);
  }
}

module.exports = { logToSheets };
