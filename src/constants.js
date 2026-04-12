// ─── Constants ────────────────────────────────────────────────────────────────
// Generate 30-min slots 7:00 AM – 7:00 PM
function generateServiceSlots() {
  const slots = [];
  for (let h = 7; h <= 19; h++) {
    for (const m of [0, 30]) {
      if (h === 19 && m === 30) break;
      const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const ampm = h < 12 ? "AM" : "PM";
      const timeStr = `${hour12}:${m === 0 ? "00" : "30"} ${ampm}`;
      slots.push({ id: `${h}${m}`, time: timeStr, hour: h, minute: m, duration: "30 min" });
    }
  }
  return slots;
}
const SERVICE_SLOTS = generateServiceSlots();

const SERVICES = {
  dog: {
    id: "dog", label: "Dog-walking", icon: "🐕", color: "#C4541A",
    light: "#FDF5EC", border: "#D4A843",
    slots: SERVICE_SLOTS,
  },
  cat: {
    id: "cat", label: "Cat-sitting", icon: "🐈", color: "#3D6B7A",
    light: "#EBF4F6", border: "#8EBCC6",
    slots: SERVICE_SLOTS,
  },
};

// All walkers are managed through the admin portal — no hardcoded walkers.

// All tiers charge the same flat rate ($30/30 min, $45/60 min).
// The tier you hit each week determines how many savings credits you earn per
// completed walk — redeemable for a free walk at $30 (30-min) or $45 (60-min).
const PRICING_TIERS = [
  { label: "Easy Rider", freq: "1x per week", badge: null,
    prices: { "30 min": 30, "60 min": 45 },
    creditPer30: 0, creditPer60: 0,
    description: "One walk a week — perfect for a laid-back pup who likes to take it easy." },
  { label: "Steady Stroll", freq: "3x per week", badge: "Popular",
    prices: { "30 min": 30, "60 min": 45 },
    creditPer30: 2.50, creditPer60: 2.50,
    description: "Three walks a week — earn $2.50 in Bark Bucks per completed session." },
  { label: "Full Gallop", freq: "5x per week", badge: "Best Value",
    prices: { "30 min": 30, "60 min": 45 },
    creditPer30: 5.00, creditPer60: 5.00,
    description: "Five walks a week — earn $5.00 in Bark Bucks per completed session." },
];

const ADD_ONS = [
  { icon: "🐶", label: "Additional Dog", price: "+$10/dog/session", note: "Applies to any session length or frequency." },
  { icon: "🌙", label: "Overnight Stay", price: "$150/night", note: "A walker stays at your home overnight." },
  { icon: "📅", label: "Same-Day Multi-Booking", price: "20% off", note: "Book 2+ services on the same day." },
  { icon: "🐾", label: "Bark Bucks", price: "Earn per walk", note: "Book 3x or 5x a week to earn Bark Bucks toward a free walk." },
  { icon: "👥", label: "Refer a Friend", price: "$100 credit", note: "Earn a $100 credit after their first booking." },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Returns the price after any admin discount is applied.
// Discount stored as b.adminDiscount = { type: "percent"|"dollar", amount: number }
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
const WALKER_SERVICES = [
  { id: "dog-walking",        label: "Dog Walker",         icon: "🐕", color: "#C4541A", bg: "#FDF5EC", border: "#D4A843" },
  { id: "cat-sitting",        label: "Cat Sitter",         icon: "🐈", color: "#3D6B7A", bg: "#EBF4F6", border: "#8ECAD4" },
  { id: "pet-transportation", label: "Pet Transportation", icon: "🚗", color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  { id: "overnight-stays",    label: "Overnight Stays",    icon: "🌙", color: "#7A4D6E", bg: "#F7F0F5", border: "#E8D0E0" },
];
// Hourly meet & greet slots 8:00 AM – 7:00 PM (15 min appointment)
const ALL_HANDOFF_SLOTS = (() => {
  const slots = [];
  for (let h = 8; h <= 19; h++) {
    const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const ampm   = h < 12 ? "AM" : "PM";
    const label  = `${hour12}:00 ${ampm}`;
    slots.push({ id: `h${h}`, label, time: label, hour: h, minute: 0 });
  }
  return slots;
})();

export {
  SERVICE_SLOTS, SERVICES, PRICING_TIERS, ADD_ONS, DAYS, FULL_DAYS,
  WALKER_SERVICES, ALL_HANDOFF_SLOTS,
};
