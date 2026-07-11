const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReviewCommand, normalizeAuMobile } = require('../src/reviewRequest');

test('parseReviewCommand extracts name and trailing mobile', () => {
  assert.deepEqual(parseReviewCommand('REVIEW Sarah Mitchell 0412345678'), {
    name: 'Sarah Mitchell',
    rawMobile: '0412345678',
  });
});

test('parseReviewCommand handles spaced mobile numbers', () => {
  assert.deepEqual(parseReviewCommand('review Jade Wilson 0412 345 678'), {
    name: 'Jade Wilson',
    rawMobile: '0412 345 678',
  });
});

test('parseReviewCommand returns null with no phone number', () => {
  assert.equal(parseReviewCommand('REVIEW just a name'), null);
});

test('parseReviewCommand is case-insensitive on the keyword', () => {
  assert.deepEqual(parseReviewCommand('Review Sam Lee 0412345678'), {
    name: 'Sam Lee',
    rawMobile: '0412345678',
  });
});

test('normalizeAuMobile handles 04xx format', () => {
  assert.equal(normalizeAuMobile('0412345678'), '+61412345678');
});

test('normalizeAuMobile handles +614xx format', () => {
  assert.equal(normalizeAuMobile('+61412345678'), '+61412345678');
});

test('normalizeAuMobile handles spaces and dashes', () => {
  assert.equal(normalizeAuMobile('0412-345-678'), '+61412345678');
});

test('normalizeAuMobile rejects invalid/short numbers', () => {
  assert.equal(normalizeAuMobile('12345'), null);
  assert.equal(normalizeAuMobile('0212345678'), null); // not a mobile prefix
});
