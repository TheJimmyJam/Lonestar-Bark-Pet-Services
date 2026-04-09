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

// Walker payout: flat rates based on duration and pricing tier
function getWalkerPayout(b) {
  const duration = b.slot?.duration || "30 min";
  const tier = b.priceTier || "Easy Rider";
  const is60 = duration === "60 min";
  // Full Gallop (5x/week) gets slightly lower flat rate
  if (tier === "Full Gallop") {
    return is60 ? 32 : 18;
  }
  // Easy Rider and Steady Stroll
  return is60 ? 35 : 20;
}

// Format a Date object as YYYY-MM-DD
function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

// ─── Pricing Helpers ──────────────────────────────────────────────────────────
const PRICE_TIERS = [
  { minBookings: 5, label: "Full Gallop", prices: { "30 min": 25, "60 min": 40 } },
  { minBookings: 3, label: "Steady Stroll", prices: { "30 min": 27.50, "60 min": 42.50 } },
  { minBookings: 1, label: "Easy Rider", prices: { "30 min": 30, "60 min": 45 } },
];

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

function getPriceTier(weekCount) {
  return PRICE_TIERS.find(t => weekCount >= t.minBookings) || PRICE_TIERS[2];
}

function getSessionPrice(duration, weekCount) {
  const tier = getPriceTier(weekCount);
  return tier.prices[duration] || tier.prices["30 min"];
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

function repriceWeekBookings(bookings) {
  // Find all bookings in the current week, sorted by bookedAt
  const { monday, sunday } = getCurrentWeekRange();
  const weekIdxs = [];
  bookings.forEach((b, i) => {
    const d = new Date(b.bookedAt);
    if (d >= monday && d <= sunday && !b.cancelled) weekIdxs.push(i);
  });
  // Reprice based on total count
  const count = weekIdxs.length;
  const tier = getPriceTier(count);
  const updated = [...bookings];
  weekIdxs.forEach(i => {
    const basePrice = tier.prices[updated[i].slot?.duration] || tier.prices["30 min"];
    const dogCharge = (updated[i].additionalDogCount || 0) * 10;
    updated[i] = { ...updated[i], price: basePrice + dogCharge, priceTier: tier.label, sameDayDiscount: false };
  });
  return updated;
}

function applySameDayDiscount(bookings) {
  // Group active bookings by calendar date (YYYY-MM-DD of scheduledDateTime)
  const byDate = {};
  bookings.forEach((b, i) => {
    if (b.cancelled || !b.scheduledDateTime) return;
    const dateKey = b.scheduledDateTime.slice(0, 10);
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(i);
  });
  const updated = [...bookings];
  // First pass: strip all existing same-day discounts to get clean base prices
  updated.forEach((b, i) => {
    if (b.sameDayDiscount && b.priceBeforeSameDayDiscount != null) {
      updated[i] = {
        ...b,
        price: b.priceBeforeSameDayDiscount,
        priceBeforeSameDayDiscount: undefined,
        sameDayDiscount: false,
      };
    }
  });
  // Second pass: apply 20% only to days that have exactly 2+ active bookings
  Object.values(byDate).forEach(idxs => {
    if (idxs.length < 2) return;
    idxs.forEach(i => {
      const base = updated[i].price || 0;
      updated[i] = {
        ...updated[i],
        price: Math.round(base * 0.8),
        priceBeforeSameDayDiscount: base,
        sameDayDiscount: true,
      };
    });
  });
  return updated;
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
  const parts = [a.street, a.city, a.state, a.zip].filter(Boolean);
  return parts.join(", ");
}
function addrFromString(s) {
  // Best-effort parse of "123 Main St, Dallas, TX 75201"
  if (!s) return { street: "", city: "", state: "", zip: "" };
  if (typeof s === "object") return { street: s.street || "", city: s.city || "", state: s.state || "", zip: s.zip || "" };
  if (typeof s !== "string") return { street: "", city: "", state: "", zip: "" };
  const parts = s.split(",").map(p => p.trim());
  return {
    street: parts[0] || "",
    city:   parts[1] || "",
    state:  parts[2] ? parts[2].replace(/\s+\d{5}.*/, "").trim() : "",
    zip:    parts[2] ? (parts[2].match(/\d{5}/) || [""])[0] : (parts[3] || ""),
  };
}
function emptyAddr() { return { street: "", city: "", state: "", zip: "" }; }

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
  PRICE_TIERS, getCurrentWeekRange, getWeekRangeForOffset,
  getBookingWeekKey, getWeekBookingCountForOffset,
  getPriceTier, getSessionPrice, getCancellationPolicy,
  repriceWeekBookings, applySameDayDiscount,
  getWeekDates, firstName, parseDateLocal, dateStrFromDate,
  generateCode,
  addrToString, addrFromString, emptyAddr, US_STATES,
  toDateKey, fmt, formatPhone,
};
