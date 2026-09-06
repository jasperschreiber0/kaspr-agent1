/**
 * Platform-neutral booking boundary.
 *
 * A real adapter can implement these methods for the first booking platform.
 * Until then, Kaspr can use manual confirmation without pretending that an
 * appointment exists in an external system.
 */
class BookingAdapter {
  constructor(name = 'manual') {
    this.name = name;
  }

  async getAvailability() {
    throw new Error(`Booking adapter "${this.name}" does not support availability yet`);
  }

  async createAppointment() {
    throw new Error(`Booking adapter "${this.name}" does not support appointment creation yet`);
  }
}

class ManualBookingAdapter extends BookingAdapter {
  constructor() {
    super('manual');
  }

  async getAvailability() {
    return [];
  }

  async createAppointment() {
    return { requiresConfirmation: true };
  }
}

function getBookingAdapter() {
  switch ((process.env.BOOKING_PROVIDER || 'manual').toLowerCase()) {
    case 'manual':
      return new ManualBookingAdapter();
    default:
      throw new Error(`Unsupported BOOKING_PROVIDER: ${process.env.BOOKING_PROVIDER}`);
  }
}

module.exports = { BookingAdapter, ManualBookingAdapter, getBookingAdapter };
