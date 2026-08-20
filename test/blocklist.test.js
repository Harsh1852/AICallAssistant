const { test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeNumber, isValidPhoneNumber } = require('../services/blocklist');

test('normalizeNumber collapses formatting to a comparable key', () => {
  const expected = '5551234567';
  for (const input of ['+1 555-123-4567', '15551234567', '555.123.4567', '(555) 123 4567', '5551234567']) {
    assert.equal(normalizeNumber(input), expected, `failed for ${input}`);
  }
});

test('normalizeNumber keeps non-US numbers intact', () => {
  // Only a leading US country code is stripped; an 11-digit number that does
  // not start with 1 must survive untouched.
  assert.equal(normalizeNumber('+44 20 7946 0958'), '442079460958');
  assert.equal(normalizeNumber('20794609581'), '20794609581');
});

test('normalizeNumber tolerates empty input', () => {
  assert.equal(normalizeNumber(''), '');
  assert.equal(normalizeNumber(null), '');
  assert.equal(normalizeNumber(undefined), '');
});

test('isValidPhoneNumber accepts real phone number formats', () => {
  for (const input of ['+15551234567', '555-123-4567', '(555) 123-4567', '+44 20 7946 0958', '5551234567']) {
    assert.equal(isValidPhoneNumber(input), true, `should accept ${input}`);
  }
});

test('isValidPhoneNumber rejects markup that would reach the dashboard', () => {
  // Regression guard: these previously passed validation because normalising
  // stripped the non-digits, while the original string was still stored and
  // rendered as HTML.
  const payloads = [
    '1<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
    "5551234567'); alert(1);//",
    '<b>5551234567</b>',
  ];
  for (const input of payloads) {
    assert.equal(isValidPhoneNumber(input), false, `should reject ${input}`);
  }
});

test('isValidPhoneNumber rejects lengths outside E.164', () => {
  assert.equal(isValidPhoneNumber('12'), false);
  assert.equal(isValidPhoneNumber(''), false);
  assert.equal(isValidPhoneNumber('1234567890123456789'), false);
});
