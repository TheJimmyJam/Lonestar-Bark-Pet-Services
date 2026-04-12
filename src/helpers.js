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
// Flat base prices — every walk charges the same rate regardless of weekly frequency.
// Tiers now determine savings CREDITS earned per completed walk, not live price.
const BASE_PRICES = { "30 min": 30, "60 min": 45 };

// FREE WALK thresholds: $30 saved → free 30-min walk, $45 saved → free 60-min walk
const FREE_WALK_THRESHOLDS = { "30 min": 30, "60 min": 45 };

// Savings credits earned per completed walk, based on weekly booking frequency.
// Credits accumulate on the client account and can be redeemed for free walks.
const SAVINGS_TIERS = [
  { minBookings: 5, label: "Full Gallop",   creditPer30: 5.00, creditPer60: 5.00 },
  { minBookings: 3, label: "Steady Stroll", creditPer30: 2.50, creditPer60: 2.50 },
  { minBookings: 1, label: "Easy Rider",    creditPer30: 0,    creditPer60: 0    },
];

// PRICE_TIERS kept for backward compatibility — prices are now flat for all tiers.
const PRICE_TIERS = SAVINGS_TIERS.map(t => ({ ...t, prices: { ...BASE_PRICES } }));

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

// Returns the savings tier (for credit calculation) based on weekly walk count
function getSavingsTier(weekCount) {
  return SAVINGS_TIERS.find(t => weekCount >= t.minBookings) || SAVINGS_TIERS[2];
}

// How much savings credit a completed walk earns, given its week's total walk count
function getWalkSavingsCredit(booking, weeklyWalkCount) {
  const tier = getSavingsTier(weeklyWalkCount);
  const is60 = (booking.slot?.duration || "30 min") === "60 min";
  return is60 ? tier.creditPer60 : tier.creditPer30;
}

function getSessionPrice(duration) {
  // All walks now charge flat rate — frequency no longer affects live price
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

// repriceWeekBookings — groups bookings by week and sets the savings tier label on each.
// Prices are now FLAT ($30/$45) regardless of tier — the tier label is preserved only
// so we know how many credits to award when a walk is completed.
function repriceWeekBookings(bookings) {
  const byWeek = {};
  bookings.forEach((b, i) => {
    if (b.cancelled) return;
    const d = new Date(b.scheduledDateTime || b.bookedAt);
    if (isNaN(d)) return;
    const dow = d.getDay();
    const off = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(d);
    mon.setDate(d.getDate() + off);
    mon.setHours(0, 0, 0, 0);
    const key = mon.toISOString().slice(0, 10);
    if (!byWeek[key]) byWeek[key] = [];
    byWeek[key].push(i);
  });

  const updated = [...bookings];
  Object.values(byWeek).forEach(idxs => {
    const count = idxs.length;
    const savingsTier = getSavingsTier(count);
    idxs.forEach(i => {
      // Never reprice completed or Stripe-paid bookings — price is locked at what was charged
      if (updated[i].adminCompleted || updated[i].stripeSessionId) return;
      const duration = updated[i].slot?.duration || "30 min";
      const basePrice = BASE_PRICES[duration] || BASE_PRICES["30 min"];
      const dogCharge = (updated[i].additionalDogCount || 0) * 10;
      // Price is flat — only priceTier label updates (used for savings credit calculation)
      updated[i] = { ...updated[i], price: basePrice + dogCharge, priceTier: savingsTier.label, sameDayDiscount: false };
    });
  });
  return updated;
}

function applySameDayDiscount(bookings) {
  // Group active bookings by calendar date (YYYY-MM-DD of scheduledDateTime).
  // Free appointments (price === 0 — e.g. meet & greet) are excluded from the
  // count so they don't trigger the 2-appointment threshold on their own.
  const byDate = {};
  bookings.forEach((b, i) => {
    if (b.cancelled || !b.scheduledDateTime) return;
    if ((b.price ?? 0) <= 0) return;
    const dateKey = b.scheduledDateTime.slice(0, 10);
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(i);
  });
  const updated = [...bookings];

  // First pass: strip same-day discounts from UNPAID bookings only so we get
  // their clean base price. Never touch already-Stripe-paid bookings — their
  // price is locked at what Stripe charged.
  updated.forEach((b, i) => {
    const alreadyPaid = !!(b.stripeSessionId && b.paidAt);
    if (!alreadyPaid && b.sameDayDiscount && b.priceBeforeSameDayDiscount != null) {
      updated[i] = {
        ...b,
        price: b.priceBeforeSameDayDiscount,
        priceBeforeSameDayDiscount: undefined,
        sameDayDiscount: false,
      };
    }
  });

  // Second pass: apply discount logic to days with 2+ active bookings
  Object.values(byDate).forEach(idxs => {
    if (idxs.length < 2) return;

    const paidIdxs   = idxs.filter(i =>  (updated[i].stripeSessionId && updated[i].paidAt));
    const unpaidIdxs = idxs.filter(i => !(updated[i].stripeSessionId && updated[i].paidAt));

    // All already paid — Stripe charges are final, nothing we can adjust.
    if (unpaidIdxs.length === 0) return;

    // No paid bookings yet — apply a straight 20% to everyone.
    if (paidIdxs.length === 0) {
      idxs.forEach(i => {
        const base = updated[i].price || 0;
        updated[i] = {
          ...updated[i],
          price: Math.round(base * 0.8),
          priceBeforeSameDayDiscount: base,
          sameDayDiscount: true,
        };
      });
      return;
    }

    // Mixed: some bookings already paid at full price, some not yet charged.
    // The discount they were owed (20% of their base) couldn't be applied at
    // checkout, so we roll it into the unpaid booking(s).
    //
    // Walk 2 price = Walk2_base × 0.8 − (Walk1_base × 0.2)
    // = their own 20% off  −  the discount missed on each paid booking
    //
    // If there are multiple unpaid bookings we split the missed discount
    // proportionally by each booking's base price.
    const paidBaseTotal   = paidIdxs.reduce((s, i) => s + (updated[i].price || 0), 0);
    const missedDiscount  = Math.round(paidBaseTotal * 0.2);
    const unpaidBaseTotal = unpaidIdxs.reduce((s, i) => s + (updated[i].price || 0), 0);

    unpaidIdxs.forEach(i => {
      const base        = updated[i].price || 0;
      const ownDiscount = Math.round(base * 0.2);
      const share       = unpaidBaseTotal > 0 ? base / unpaidBaseTotal : 1 / unpaidIdxs.length;
      const extra       = Math.round(missedDiscount * share);
      const newPrice    = Math.max(0, base - ownDiscount - extra);
      updated[i] = {
        ...updated[i],
        price: newPrice,
        priceBeforeSameDayDiscount: base,
        sameDayDiscount: true,
      };
    });
  });

  return updated;
}

// ─── Savings Credit Helpers ───────────────────────────────────────────────────

// Award savings credits when admin marks a walk complete.
// Looks at the walk's week count to determine credit tier, adds to client balance.
function awardWalkSavings(client, completedBooking) {
  const bookingWeekKey = getBookingWeekKey(completedBooking);
  const weeklyCount = (client.bookings || []).filter(b => {
    if (b.cancelled) return false;
    return getBookingWeekKey(b) === bookingWeekKey;
  }).length;

  const credit = getWalkSavingsCredit(completedBooking, weeklyCount);
  if (credit <= 0) return client; // Easy Rider earns no credits

  const currentBalance = client.savingsBalance || 0;
  const newBalance = Math.round((currentBalance + credit) * 100) / 100;
  const entry = {
    bookingKey: completedBooking.key,
    date: completedBooking.scheduledDateTime?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    credit,
    tier: completedBooking.priceTier || "Easy Rider",
    balance: newBalance,
  };

  return {
    ...client,
    savingsBalance: newBalance,
    savingsHistory: [...(client.savingsHistory || []), entry],
  };
}

// Reverse a savings credit when admin undoes a walk completion.
function revokeWalkSavings(client, bookingKey) {
  const history = client.savingsHistory || [];
  const entry = history.find(e => e.bookingKey === bookingKey);
  if (!entry) return client;
  const newBalance = Math.max(0, Math.round(((client.savingsBalance || 0) - entry.credit) * 100) / 100);
  return {
    ...client,
    savingsBalance: newBalance,
    savingsHistory: history.filter(e => e.bookingKey !== bookingKey),
  };
}

// Client claims a free walk. Deducts from balance and logs the pending claim.
// walkType: "30 min" | "60 min"
function claimFreeWalk(client, walkType) {
  const cost = FREE_WALK_THRESHOLDS[walkType] || 30;
  const currentBalance = client.savingsBalance || 0;
  if (currentBalance < cost) return null; // insufficient balance — caller should guard
  const newBalance = Math.round((currentBalance - cost) * 100) / 100;
  const claim = {
    id: `claim_${Date.now()}`,
    claimedAt: new Date().toISOString(),
    walkType,
    amount: cost,
    fulfilled: false,
  };
  return {
    ...client,
    savingsBalance: newBalance,
    freeWalkClaims: [...(client.freeWalkClaims || []), claim],
  };
}

// Admin marks a pending free walk claim as fulfilled.
function fulfillFreeWalkClaim(client, claimId) {
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
  BASE_PRICES, FREE_WALK_THRESHOLDS, SAVINGS_TIERS, PRICE_TIERS,
  getCurrentWeekRange, getWeekRangeForOffset,
  getBookingWeekKey, getWeekBookingCountForOffset,
  getPriceTier, getSavingsTier, getWalkSavingsCredit, getSessionPrice,
  getCancellationPolicy,
  repriceWeekBookings, applySameDayDiscount,
  awardWalkSavings, revokeWalkSavings, claimFreeWalk, fulfillFreeWalkClaim,
  getWeekDates, firstName, parseDateLocal, dateStrFromDate,
  generateCode,
  addrToString, addrFromString, emptyAddr, US_STATES,
  toDateKey, fmt, formatPhone,
};
