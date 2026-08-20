const { google } = require('googleapis');
const { googleAuthClient } = require('../lib/googleAuth');

// Requires a tab named exactly "Blocklist" in the same spreadsheet as
// GOOGLE_SHEET_ID, with headers: Phone Number | Reason | Date Added.
const SHEET_RANGE = 'Blocklist!A:C';

// In-memory cache checked on every incoming call — must be instant, so
// blocking never adds latency to answering a call. Sheets is the persistent
// source of truth: loaded at startup, refreshed periodically in case the
// sheet was edited directly, and rewritten whenever the dashboard adds or
// removes a number.
let blockedNumbers = new Map(); // normalized digits -> { raw, reason, dateAdded }

// Strips formatting and a leading US country code so "+1 555-123-4567",
// "15551234567", and "555.123.4567" all normalize to the same key.
function normalizeNumber(n) {
  const digits = (n || '').replace(/\D/g, '');
  return digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
}

// The stored `raw` value is rendered in the dashboard and written to a
// spreadsheet, so it must not be arbitrary text. Normalising alone isn't
// enough — it strips non-digits, so "1<script>" would normalise to a valid-
// looking "1" while keeping the payload in `raw`. Requiring a plausible E.164
// number means only digits, spaces and standard punctuation are ever stored.
const PHONE_SHAPE = /^\+?[\d\s().-]{7,20}$/;

// E.164 allows up to 15 digits; below 7 is not a dialable number anywhere.
function isValidPhoneNumber(rawNumber) {
  const raw = String(rawNumber || '').trim();
  if (!PHONE_SHAPE.test(raw)) return false;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function isBlocked(callerNumber) {
  return blockedNumbers.has(normalizeNumber(callerNumber));
}

function getBlockedNumbers() {
  return Array.from(blockedNumbers.values());
}

async function getSheetsClient() {
  const auth = googleAuthClient();
  if (!auth) return null;
  return google.sheets({ version: 'v4', auth });
}

async function refreshBlocklist() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return;
  try {
    const sheets = await getSheetsClient();
    if (!sheets) return;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: SHEET_RANGE });
    const rows = (resp.data.values || []).slice(1); // skip header row
    const next = new Map();
    for (const [raw, reason, dateAdded] of rows) {
      if (!raw) continue;
      next.set(normalizeNumber(raw), { raw, reason: reason || '', dateAdded: dateAdded || '' });
    }
    blockedNumbers = next;
    console.log(`🚫 Blocklist loaded: ${blockedNumbers.size} number(s)`);
  } catch (err) {
    console.error('Blocklist refresh error (create a "Blocklist" tab in your sheet if missing):', err.message);
  }
}

// Rewrites the whole range from the in-memory cache — simpler and more
// reliable than finding/deleting individual rows via the Sheets API for a
// list this size.
// values.clear() followed by values.update() is two API calls with a window
// between them where the sheet is empty. Two concurrent add/remove requests
// interleaving there could clear one write and leave the sheet inconsistent
// with memory, so writes are chained instead of run in parallel.
let persistQueue = Promise.resolve();

function persistBlocklist() {
  persistQueue = persistQueue.then(doPersist, doPersist);
  return persistQueue;
}

async function doPersist() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return;
  const sheets = await getSheetsClient();
  if (!sheets) return;
  const rows = [
    ['Phone Number', 'Reason', 'Date Added'],
    ...Array.from(blockedNumbers.values()).map(b => [b.raw, b.reason, b.dateAdded]),
  ];
  // values.update only overwrites cells it's given data for — it does NOT
  // clear leftover rows from a previous, longer list, so a removal that
  // shrinks the list would otherwise leave stale rows behind. Clear the
  // whole range first, then write the current set.
  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: SHEET_RANGE });
  await sheets.spreadsheets.values.update({
    spreadsheetId:    sheetId,
    range:            SHEET_RANGE,
    valueInputOption: 'RAW',
    requestBody:      { values: rows },
  });
}

// Applies in-memory immediately (so blocking takes effect right away even if
// Sheets is unreachable) and persists best-effort, same pattern as
// logToSheets/notifyOwner elsewhere — a persistence hiccup is logged, not
// surfaced as a failure of the block itself.
async function addBlockedNumber(rawNumber, reason = '') {
  if (!isValidPhoneNumber(rawNumber)) {
    throw new Error('Invalid phone number. Use digits only, e.g. +15551234567.');
  }
  const normalized = normalizeNumber(rawNumber);
  const raw = String(rawNumber).trim();
  // Reason is free text by design, but it is stored and displayed, so cap it
  // rather than letting an arbitrarily long string into the sheet.
  const safeReason = String(reason || '').trim().slice(0, 200);
  blockedNumbers.set(normalized, { raw, reason: safeReason, dateAdded: new Date().toISOString() });
  await persistBlocklist().catch(err => console.error('Blocklist persist error:', err.message));
}

async function removeBlockedNumber(rawNumber) {
  const normalized = normalizeNumber(rawNumber);
  blockedNumbers.delete(normalized);
  await persistBlocklist().catch(err => console.error('Blocklist persist error:', err.message));
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

// Started explicitly from index.js rather than on import. Doing this as an
// import side effect meant merely requiring the module fired a network call
// and pinned an interval, which kept short-lived processes (tests, scripts)
// from ever exiting.
function startBlocklistSync() {
  refreshBlocklist().catch(console.error);
  const timer = setInterval(() => refreshBlocklist().catch(console.error), REFRESH_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = {
  isBlocked,
  getBlockedNumbers,
  addBlockedNumber,
  removeBlockedNumber,
  refreshBlocklist,
  startBlocklistSync,
  normalizeNumber,
  isValidPhoneNumber,
};
