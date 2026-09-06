const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBooking } = require('../src/bookingValidation');
const input = {clientId:'client',opportunityId:'opportunity',bookingId:'booking'};
test('rejects coercible and invalid money inputs', () => {
  for (const amount of [null, undefined, '', '20', false, NaN, Infinity, -1]) {
    assert.throws(() => validateBooking(input, amount));
  }
  assert.doesNotThrow(() => validateBooking(input, 0));
  assert.doesNotThrow(() => validateBooking(input, 280));
});
test('requires client and external booking identity', () => {
  for (const key of Object.keys(input)) assert.throws(() => validateBooking({...input,[key]:''},280));
});
