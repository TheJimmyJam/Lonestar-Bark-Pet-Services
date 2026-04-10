import { SERVICES, SERVICE_SLOTS } from "../constants.js";
import { saveClients } from "../supabase.js";
import { getWeekDates, getWeekRangeForOffset, getWeekBookingCountForOffset, getSessionPrice, getPriceTier, applySameDayDiscount } from "../helpers.js";
import { autoCreateWalkInvoice, generateInvoiceId } from "./invoices/invoiceHelpers.js";

// ─── Generate concrete booking entries from recurring schedules ───────────────
// ─── Generate concrete booking entries from recurring schedules ───────────────
// Produces WEEKS_AHEAD weeks of upcoming bookings so they appear on all dashboards.
const RECURRING_WEEKS_AHEAD = 8;

function generateRecurringBookings(recurringSchedules, clientInfo) {
  const bookings = [];
  const now = new Date();

  recurringSchedules.forEach(rec => {
    for (let w = 0; w < RECURRING_WEEKS_AHEAD; w++) {
      const { monday: wMon } = getWeekRangeForOffset(w);

      // Build the appointment date: monday + dayOfWeek offset
      const apptDate = new Date(wMon);
      apptDate.setDate(wMon.getDate() + rec.dayOfWeek);

      // Parse time string e.g. "9:00 AM"
      const [timePart, meridiem] = rec.slotTime.split(" ");
      let [hours, minutes] = timePart.split(":").map(Number);
      if (meridiem === "PM" && hours !== 12) hours += 12;
      if (meridiem === "AM" && hours === 12) hours = 0;
      apptDate.setHours(hours, minutes || 0, 0, 0);

      // Skip past slots
      if (apptDate <= now) continue;

      const dateLabel = apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const dayName = FULL_DAYS[rec.dayOfWeek];

      bookings.push({
        key: `rec-${rec.id}-${apptDate.toISOString().slice(0, 10)}`,
        service: rec.service,
        day: dayName,
        date: dateLabel,
        slot: {
          id: rec.slotId,
          time: rec.slotTime,
          duration: rec.duration,
          hour: hours,
          minute: minutes || 0,
        },
        form: { ...rec.form },
        bookedAt: new Date().toISOString(),
        scheduledDateTime: apptDate.toISOString(),
        additionalDogCount: rec.additionalDogCount || 0,
        additionalDogCharge: 0,
        price: getSessionPrice(rec.duration, 1),
        priceTier: "Easy Rider",
        isRecurring: true,
        recurringId: rec.id,
      });
    }
  });

  return bookings;
}

// Ensure each client's recurring schedules have concrete bookings up to RECURRING_WEEKS_AHEAD.
// Returns a new clients object only if changes were needed, otherwise returns the same reference.
function extendRecurringBookings(clients) {
  const now = new Date();
  const { sunday: horizonDate } = getWeekRangeForOffset(RECURRING_WEEKS_AHEAD - 1);
  let changed = false;
  const updated = {};

  Object.entries(clients).forEach(([id, c]) => {
    const recs = c.recurringSchedules || [];
    if (recs.length === 0) { updated[id] = c; return; }

    const existingKeys = new Set((c.bookings || []).map(b => b.key));
    const newBookings = [];

    recs.forEach(rec => {
      if (rec.cancelledWeeks && rec.cancelledWeeks.length === RECURRING_WEEKS_AHEAD * 53) return; // fully cancelled
      for (let w = 0; w < RECURRING_WEEKS_AHEAD; w++) {
        const { monday: wMon } = getWeekRangeForOffset(w);
        const apptDate = new Date(wMon);
        apptDate.setDate(wMon.getDate() + rec.dayOfWeek);

        const [timePart, meridiem] = rec.slotTime.split(" ");
        let [hours, minutes] = timePart.split(":").map(Number);
        if (meridiem === "PM" && hours !== 12) hours += 12;
        if (meridiem === "AM" && hours === 12) hours = 0;
        apptDate.setHours(hours, minutes || 0, 0, 0);

        if (apptDate <= now) continue;
        if (rec.cancelledWeeks && rec.cancelledWeeks.includes(wMon.toISOString().slice(0, 10))) continue;

        const bookingKey = `rec-${rec.id}-${apptDate.toISOString().slice(0, 10)}`;
        if (existingKeys.has(bookingKey)) continue; // already exists

        const dateLabel = apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        newBookings.push({
          key: bookingKey,
          service: rec.service,
          day: FULL_DAYS[rec.dayOfWeek],
          date: dateLabel,
          slot: { id: rec.slotId, time: rec.slotTime, duration: rec.duration, hour: hours, minute: minutes || 0 },
          form: { ...rec.form },
          bookedAt: new Date().toISOString(),
          scheduledDateTime: apptDate.toISOString(),
          additionalDogCount: rec.additionalDogCount || 0,
          additionalDogCharge: 0,
          price: getSessionPrice(rec.duration, 1),
          priceTier: "Easy Rider",
          isRecurring: true,
          recurringId: rec.id,
        });
      }
    });

    if (newBookings.length > 0) {
      changed = true;
      const merged = applySameDayDiscount(repriceWeekBookings([...(c.bookings || []), ...newBookings]));
      updated[id] = { ...c, bookings: merged };
    } else {
      updated[id] = c;
    }
  });

  return changed ? updated : clients;
}

// When a recurring booking is completed, spawn the next occurrence so the
// series continues indefinitely without relying on the 8-week horizon window.
function spawnNextRecurringOccurrence(clientRecord, completedBooking) {
  if (!completedBooking.isRecurring || !completedBooking.recurringId) return null;

  const rec = (clientRecord.recurringSchedules || []).find(r => r.id === completedBooking.recurringId);
  if (!rec) return null;

  // Find the latest future booking date already existing for this series
  const existingDates = (clientRecord.bookings || [])
    .filter(b => b.recurringId === rec.id && !b.adminCompleted)
    .map(b => new Date(b.scheduledDateTime))
    .sort((a, b) => b - a); // newest first

  // Start from the day after the latest existing occurrence (or today if none)
  const lastDate = existingDates.length > 0 ? existingDates[0] : new Date();

  // Advance by one week from the last occurrence
  const nextDate = new Date(lastDate);
  nextDate.setDate(nextDate.getDate() + 7);

  // Parse the time
  const [timePart, meridiem] = rec.slotTime.split(" ");
  let [hours, minutes] = timePart.split(":").map(Number);
  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  nextDate.setHours(hours, minutes || 0, 0, 0);

  // Don't create a duplicate if this key already exists
  const nextKey = `rec-${rec.id}-${nextDate.toISOString().slice(0, 10)}`;
  if ((clientRecord.bookings || []).some(b => b.key === nextKey)) return null;

  const dateLabel = nextDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return {
    key: nextKey,
    service: rec.service,
    day: FULL_DAYS[rec.dayOfWeek],
    date: dateLabel,
    slot: { id: rec.slotId, time: rec.slotTime, duration: rec.duration, hour: hours, minute: minutes || 0 },
    form: { ...rec.form },
    bookedAt: new Date().toISOString(),
    scheduledDateTime: nextDate.toISOString(),
    additionalDogCount: rec.additionalDogCount || 0,
    additionalDogCharge: 0,
    price: getSessionPrice(rec.duration, 1),
    priceTier: "Easy Rider",
    isRecurring: true,
    recurringId: rec.id,
  };
}

export { generateRecurringBookings, extendRecurringBookings, spawnNextRecurringOccurrence };
