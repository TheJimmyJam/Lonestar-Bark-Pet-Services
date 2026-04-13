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

// Simple flat pricing — $30 for 30 min, $45 for 60 min.
const BASE_PRICES = { "30 min": 30, "60 min": 45 };

const ADD_ONS = [
  { icon: "🐶", label: "Additional Dog", price: "+$10/dog/session", note: "Applies to any session length or frequency." },
  { icon: "🌙", label: "Overnight Stay", price: "$150/night", note: "A walker stays at your home overnight." },
  { icon: "🤝", label: "Meet & Greet Discount", price: "20% off", note: "Book your first walk during the meet & greet and save 20%." },
  { icon: "🥊", label: "Punch Card", price: "10 walks = 1 free", note: "Every walk earns a punch. After 10 walks, claim one free 60-minute walk." },
  { icon: "👥", label: "Refer a Friend", price: "$100 credit", note: "Earn a $100 credit after their first booking." },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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
  SERVICE_SLOTS, SERVICES, BASE_PRICES, ADD_ONS, DAYS, FULL_DAYS,
  WALKER_SERVICES, ALL_HANDOFF_SLOTS,
};
