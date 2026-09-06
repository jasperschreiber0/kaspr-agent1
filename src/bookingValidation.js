function validateBooking(input, value) {
  if (!input.clientId || !input.opportunityId || typeof input.bookingId !== 'string' || !input.bookingId.trim()) {
    throw new Error('Client, opportunity and booking reference required');
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Value must be a finite nonnegative number');
  }
}
module.exports = { validateBooking };
