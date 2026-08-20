const express = require('express');
const router  = express.Router();

const { activeCalls, endedCalls } = require('../lib/callStore');
const { doTakeoverApi } = require('../services/takeover');
const { getBlockedNumbers, addBlockedNumber, removeBlockedNumber } = require('../services/blocklist');
const { getCallHistory } = require('../services/callHistory');
const { requireDashboardAuth } = require('../lib/dashboardAuth');

// These endpoints expose caller numbers and full transcripts, and /api/takeover
// places a real outbound call — all of them require credentials.
router.use('/api', requireDashboardAuth);

// ── ROUTE 5: Dashboard API ───────────────────────────────────────────────────
router.get('/api/calls', (_req, res) => {
  const active = Object.entries(activeCalls).map(([sid, c]) => ({
    callSid:      sid,
    callerNumber: c.callerNumber,
    status:       c.status,
    duration:     Math.floor((Date.now() - c.startTime) / 1000),
    transcript:   c.transcript,
    outcome:      null,
    startTime:    c.startTime,
  }));

  const ended = Object.entries(endedCalls).map(([sid, c]) => ({
    callSid:      sid,
    callerNumber: c.callerNumber,
    status:       c.status,
    duration:     Math.floor((c.endTime - c.startTime) / 1000),
    transcript:   c.transcript,
    outcome:      c.outcome,
    endTime:      c.endTime,
    startTime:    c.startTime,
  }));

  // Sort ended calls newest first
  ended.sort((a, b) => new Date(b.endTime) - new Date(a.endTime));

  res.json({ active, ended });
});

// ── ROUTE 5b: Past calls, read back from the Sheets log ─────────────────────
// Deliberately NOT part of /api/calls: that one is polled every 2 seconds and
// has to stay a fixed size, while this grows without bound and is fetched
// only when the user opens the history view.
router.get('/api/calls/history', async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const q      = typeof req.query.q === 'string' ? req.query.q : '';

  try {
    res.json(await getCallHistory({ limit, offset, q }));
  } catch (err) {
    // Best-effort, same as the rest of the Sheets integration — a history
    // fetch failing is a message in the modal, never a broken dashboard.
    console.error('Call history error:', err.message);
    res.json({ calls: [], total: 0, hasMore: false, configured: true, error: err.message });
  }
});

// ── ROUTE 6: Take over from dashboard ───────────────────────────────────────
router.post('/api/takeover', async (req, res) => {
  const { callSid } = req.body;
  const call = activeCalls[callSid];

  if (!call || call.status !== 'active') {
    return res.json({ success: false, error: 'Call is not active.' });
  }

  try {
    await doTakeoverApi(callSid, call);
    res.json({ success: true });
  } catch (err) {
    console.error('Takeover error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ── ROUTE 7: Blocklist management ────────────────────────────────────────────
router.get('/api/blocklist', (_req, res) => {
  res.json({ blocked: getBlockedNumbers() });
});

router.post('/api/blocklist', async (req, res) => {
  const { number, reason } = req.body;
  if (!number) return res.json({ success: false, error: 'Phone number is required.' });

  try {
    await addBlockedNumber(number, reason || '');
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/api/blocklist/remove', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.json({ success: false, error: 'Phone number is required.' });

  try {
    await removeBlockedNumber(number);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
