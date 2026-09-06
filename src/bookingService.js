const { validateBooking } = require('./bookingValidation');
function createBookingService(db) {
  async function transition(action, input, value) {
    validateBooking(input, value);
    const { error } = await db.rpc('kaspr_booking_transition', {
      p_opportunity: input.opportunityId, p_client: input.clientId,
      p_action: action, p_booking: input.bookingId, p_value: value,
    });
    if (error) throw error;
  }
  return {
    markAppointmentBooked: input => transition('appointment_booked', input, input.bookingValue),
    markAppointmentCompleted: input => transition('appointment_completed', input, input.completedValue),
    attributeRevenue: input => transition('revenue_attributed', input, input.recoveredValue),
  };
}
let service;
function getService() {
  if (!service) {
    const { createClient } = require('@supabase/supabase-js');
    service = createBookingService(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY));
  }
  return service;
}
module.exports = { createBookingService,
  markAppointmentBooked: input => getService().markAppointmentBooked(input),
  markAppointmentCompleted: input => getService().markAppointmentCompleted(input),
  attributeRevenue: input => getService().attributeRevenue(input),
};
