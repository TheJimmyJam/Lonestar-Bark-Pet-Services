// ─── Helpers (pricing, date, address, formatting) ────────────────────────────

// Returns the price after any admin discount is applied.
function effectivePrice(b) {
  const base = b.price || 0;
  if (!b.adminDiscount || !b.adminDiscount.amount) return base;
  if (b.adminDiscount.type === "percent") {
    return Math.max(0, Math.round(base * (1 - b.adminDiscount.amount / 100)));
  }
  return Math.max(0, base - b.adminDiscount.amount);
}

// Walker payout: flat rates at full price, scaled down proportionally when a
// discount is applied so the walker and company both share the reduction.
// 60 min full: $35 payout ($10 company). 30 min full: $20 payout ($10 company).
// If the client pays less (e.g. 20% off $45 = $36), the walker also earns 20%
// less ($28), and the company keeps $8. Payout is always rounded to nearest $1.
function getWalkerPayout(b) {
  const is60 = (b.slot?.duration || "30 min") === "60 min";
  const flatPayout = is60 ? 35 : 20;
  const basePrice = is60 ? 45 : 30;
  const charged = effectivePrice(b);
  // If no discount (or price missing), just return the flat rate.
  if (!charged || charged >= basePrice) return flatPayout;
  return Math.round(flatPayout * (charged / basePrice));
}

// Format a Date object as YYYY-MM-DD
function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

// ─── Pricing Helpers ──────────────────────────────────────────────────────────
// Flat base prices — every walk charges the same rate regardless of weekly frequency.
const BASE_PRICES = { "30 min": 30, "60 min": 45 };

// Punch card loyalty: buy 10 walks (any length), get one free 60-min walk.
const PUNCH_CARD_GOAL = 10;

function getCurrentWeekRange() {
  const today = new Date();
  const dow = today.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function getWeekRangeForOffset(weekOffset) {
  const today = new Date();
  const dow = today.getDay();
  const off = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + off + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

// Returns the ISO weekKey (Monday date) for any booking
function getBookingWeekKey(b) {
  const d = new Date(b.scheduledDateTime || b.completedAt || b.bookedAt);
  const dow = d.getDay();
  const off = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + off);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function getWeekBookingCountForOffset(bookings, weekOffset) {
  const { monday, sunday } = getWeekRangeForOffset(weekOffset);
  return (bookings || []).filter(b => {
    if (b.cancelled) return false;
    const d = new Date(b.scheduledDateTime || b.bookedAt);
    return d >= monday && d <= sunday;
  }).length;
}

function getSessionPrice(duration) {
  return BASE_PRICES[duration] || BASE_PRICES["30 min"];
}

function getCancellationPolicy(scheduledDateTime) {
  const now = new Date();
  const apptTime = new Date(scheduledDateTime);
  const hoursUntil = (apptTime - now) / (1000 * 60 * 60);
  if (hoursUntil > 24) return { penalty: 0, label: "Free cancellation", color: "#C4541A", canCancel: true };
  if (hoursUntil > 12) return { penalty: 0.5, label: "50% cancellation fee", color: "#b45309", canCancel: true };
  if (hoursUntil > 0)  return { penalty: 1.0, label: "100% cancellation fee", color: "#dc2626", canCancel: true };
  return { penalty: 1.0, label: "Appointment passed", color: "#9ca3af", canCancel: false };
}

// repriceBookings — ensures every unpaid, non-completed booking has the correct flat price.
// Meet & greet discounted bookings (sameDayDiscount flag) are left untouched —
// their 20% off is intentional and was set at booking time.
function repriceWeekBookings(bookings) {
  return bookings.map(b => {
    if (b.cancelled || b.adminCompleted || b.stripeSessionId || b.sameDayDiscount) return b;
    const duration = b.slot?.duration || "30 min";
    const basePrice = BASE_PRICES[duration] || BASE_PRICES["30 min"];
    const dogCharge = (b.additionalDogCount || 0) * 10;
    return { ...b, price: basePrice + dogCharge };
  });
}

// ─── Punch Card Helpers ───────────────────────────────────────────────────────
// Loyalty program: every paid walk earns 1 punch. After 10 punches the client
// can claim one free 60-minute walk. Punches are stored in punchCardHistory so
// we can de-duplicate and revoke if a booking is cancelled.

// Award a punch when a booking is paid. Guards against double-awarding.
function awardPunchCard(client, booking) {
  const alreadyPunched = (client.punchCardHistory || []).some(e => e.bookingKey === booking.key);
  if (alreadyPunched) return client;
  const entry = {
    bookingKey: booking.key,
    date: booking.scheduledDateTime?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  };
  return {
    ...client,
    punchCardCount: (client.punchCardCount || 0) + 1,
    punchCardHistory: [...(client.punchCardHistory || []), entry],
  };
}

// Remove a punch when a booking is cancelled or un-completed.
function revokePunchCard(client, bookingKey) {
  const history = client.punchCardHistory || [];
  const entry = history.find(e => e.bookingKey === bookingKey);
  if (!entry) return client;
  return {
    ...client,
    punchCardCount: Math.max(0, (client.punchCardCount || 0) - 1),
    punchCardHistory: history.filter(e => e.bookingKey !== bookingKey),
  };
}

// Client redeems 10 punches for a free 60-minute walk.
function claimPunchCardWalk(client) {
  const count = client.punchCardCount || 0;
  if (count < PUNCH_CARD_GOAL) return null; // caller should guard
  const claim = {
    id: `claim_${Date.now()}`,
    claimedAt: new Date().toISOString(),
    walkType: "60 min",
    fulfilled: false,
  };
  return {
    ...client,
    punchCardCount: count - PUNCH_CARD_GOAL,
    freeWalkClaims: [...(client.freeWalkClaims || []), claim],
  };
}

// Admin marks a pending punch card claim as fulfilled.
function fulfillPunchCardClaim(client, claimId) {
  return {
    ...client,
    freeWalkClaims: (client.freeWalkClaims || []).map(c =>
      c.id === claimId ? { ...c, fulfilled: true, fulfilledAt: new Date().toISOString() } : c
    ),
  };
}

function getWeekDates(weekOffset = 0) {
  const today = new Date();
  const dow = today.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offset + weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}
// Parse a YYYY-MM-DD string as LOCAL midnight (not UTC) to avoid timezone-shift bugs
// Returns just the first name of a walker — used in client-facing UI
function firstName(fullName) {
  if (!fullName) return "";
  return fullName.trim().split(" ")[0];
}

function parseDateLocal(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateStrFromDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Simulated email verification code (in production this would be sent via email)
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Address Helpers ─────────────────────────────────────────────────────────
// Addresses are stored as { street, city, state, zip } plus a flat `address`
// string for display and geocoding.
function addrToString(a) {
  if (!a || typeof a === "string") return a || "";
  const parts = [a.street, a.unit ? `Unit ${a.unit}` : null, a.city, a.state, a.zip].filter(Boolean);
  return parts.join(", ");
}
function addrFromString(s) {
  // Best-effort parse of "123 Main St, Dallas, TX 75201"
  if (!s) return { street: "", unit: "", city: "", state: "", zip: "" };
  if (typeof s === "object") return { street: s.street || "", unit: s.unit || "", city: s.city || "", state: s.state || "", zip: s.zip || "" };
  if (typeof s !== "string") return { street: "", unit: "", city: "", state: "", zip: "" };
  const parts = s.split(",").map(p => p.trim());
  return {
    street: parts[0] || "",
    unit:   "",   // legacy strings don't have a parseable unit field
    city:   parts[1] || "",
    state:  parts[2] ? parts[2].replace(/\s+\d{5}.*/, "").trim() : "",
    zip:    parts[2] ? (parts[2].match(/\d{5}/) || [""])[0] : (parts[3] || ""),
  };
}
function emptyAddr() { return { street: "", unit: "", city: "", state: "", zip: "" }; }

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC",
]);

// Phone formatter — strips non-digits, caps at 10, outputs xxx.xxx.xxxx
// Format a number or dollar amount with commas: fmt(1234.5) → "1,235"  fmt(1234.5, true) → "$1,235"
function fmt(n, dollars = false) {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return dollars ? "$0" : "0";
  const rounded = Math.round(num);
  const formatted = rounded.toLocaleString("en-US");
  return dollars ? `$${formatted}` : formatted;
}

function formatPhone(raw) {
  const digits = (raw || "").replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
}

export {
  effectivePrice, getWalkerPayout,
  BASE_PRICES, PUNCH_CARD_GOAL,
  getCurrentWeekRange, getWeekRangeForOffset,
  getBookingWeekKey, getWeekBookingCountForOffset,
  getSessionPrice,
  getCancellationPolicy,
  repriceWeekBookings,
  awardPunchCard, revokePunchCard, claimPunchCardWalk, fulfillPunchCardClaim,
  getWeekDates, firstName, parseDateLocal, dateStrFromDate,
  generateCode,
  addrToString, addrFromString, emptyAddr, US_STATES,
  toDateKey, fmt, formatPhone,
};
