const test = require('node:test');
const assert = require('node:assert/strict');
const { ManualBookingAdapter, getBookingAdapter } = require('./bookingAdapter');

test('manual booking adapter never claims an appointment was created', async () => {
  const adapter = new ManualBookingAdapter();
  assert.deepEqual(await adapter.getAvailability(), []);
  assert.deepEqual(await adapter.createAppointment(), { requiresConfirmation: true });
});

test('manual is the safe default booking provider', () => {
  delete process.env.BOOKING_PROVIDER;
  assert.equal(getBookingAdapter().name, 'manual');
});
