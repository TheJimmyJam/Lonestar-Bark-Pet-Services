import { useState, useEffect, useRef, useMemo } from "react";
import { ADD_ONS, ALL_HANDOFF_SLOTS, DAYS, FULL_DAYS, SERVICES, SERVICE_SLOTS, WALKER_SERVICES } from "../../constants.js";
import {
  loadClients,
  saveClients, notifyAdmin, sendBookingConfirmation, sendWalkerBookingNotification, sendWalkerCancellationNotification, sendClientCancellationNotification, createBookingCheckout, createRefund,
  loadChatMessages, saveChatMessage, formatChatTime,
  loadClientMessages, saveClientMessage,
  loadAllWalkersAvailability,
  saveContactSubmission,
} from "../../supabase.js";
import {
  effectivePrice, getWalkerPayout,
  PUNCH_CARD_GOAL,
  getCurrentWeekRange, getWeekRangeForOffset,
  getBookingWeekKey, getWeekBookingCountForOffset,
  getSessionPrice, getCancellationPolicy,
  repriceWeekBookings,
  claimPunchCardWalk,
  getWeekDates, firstName, parseDateLocal, dateStrFromDate,
  fmt, formatPhone, addrToString, toDateKey,
} from "../../helpers.js";
import ClientNav from "../shared/ClientNav.jsx";
import Header from "../shared/Header.jsx";
import ClientMyInfoPage from "./ClientMyInfoPage.jsx";
import QuickRebookBanner from "./QuickRebookBanner.jsx";
import ClientInvoicesPage from "../invoices/ClientInvoicesPage.jsx";
import HandoffFlow from "../HandoffFlow.jsx";
import { invoiceStatusMeta } from "../invoices/invoiceHelpers.js";
import { spawnNextRecurringOccurrence } from "../recurring.js";
import { GLOBAL_STYLES } from "../../styles.js";
import { getAllWalkers } from "../auth/WalkerAuthScreen.jsx";
import AddressFields from "../shared/AddressFields.jsx";
import { addrFromString, revokePunchCard } from "../../helpers.js";
import { loadInvoicesFromDB } from "../../supabase.js";

// ─── Scroll Picker ────────────────────────────────────────────────────────────
function ScrollPicker({ items, value, onChange, itemHeight = 44, visibleCount = 5, renderItem }) {
  const scrollRef = useRef(null);
  const timerRef  = useRef(null);

  const getIndex = (val) => {
    if (!val && val !== 0) return 0;
    const idx = items.findIndex(item => (item?.id ?? item) === val);
    return idx >= 0 ? idx : 0;
  };

  // Sync scroll position when value or items change
  useEffect(() => {
    if (!scrollRef.current || items.length === 0) return;
    const idx = getIndex(value);
    scrollRef.current.scrollTop = idx * itemHeight;
  }, [value, items]);

  // Auto-commit the first item when value is empty (on mount or items swap)
  useEffect(() => {
    if (items.length === 0) return;
    if (value === "" || value === null || value === undefined) {
      const first = items[0];
      onChange(first?.id ?? first);
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!scrollRef.current) return;
      const idx = Math.round(scrollRef.current.scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(idx, items.length - 1));
      scrollRef.current.scrollTo({ top: clamped * itemHeight, behavior: "smooth" });
      const item = items[clamped];
      const val = item?.id ?? item;
      if (val !== value) onChange(val);
    }, 90);
  };

  const padding = Math.floor(visibleCount / 2) * itemHeight;

  return (
    <div style={{ position: "relative", height: visibleCount * itemHeight, overflow: "hidden" }}>
      <style>{`.sp-scroll::-webkit-scrollbar{display:none}`}</style>
      {/* Selection highlight */}
      <div style={{
        position: "absolute", left: "6px", right: "6px",
        top: "50%", transform: "translateY(-50%)",
        height: itemHeight, background: "#f3f4f6",
        borderRadius: "8px", pointerEvents: "none", zIndex: 1,
      }} />
      {/* Top fade */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: padding * 0.75,
        background: "linear-gradient(to bottom, rgba(255,255,255,0.97), rgba(255,255,255,0))",
        pointerEvents: "none", zIndex: 3,
      }} />
      {/* Bottom fade */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: padding * 0.75,
        background: "linear-gradient(to top, rgba(255,255,255,0.97), rgba(255,255,255,0))",
        pointerEvents: "none", zIndex: 3,
      }} />
      {/* Scrollable list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="sp-scroll"
        style={{
          position: "relative", zIndex: 2,
          height: "100%", overflowY: "scroll",
          scrollSnapType: "y mandatory",
          paddingTop: `${padding}px`,
          paddingBottom: `${padding}px`,
          msOverflowStyle: "none", scrollbarWidth: "none",
        }}
      >
        {items.map((item, i) => {
          const itemVal = item?.id ?? item;
          const isSelected = value ? itemVal === value : i === 0;
          const label = renderItem ? renderItem(item) : (item?.time ?? item?.label ?? String(item));
          return (
            <div
              key={String(itemVal)}
              onClick={() => {
                onChange(itemVal);
                scrollRef.current?.scrollTo({ top: i * itemHeight, behavior: "smooth" });
              }}
              style={{
                height: itemHeight, scrollSnapAlign: "center",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: isSelected ? 15 : 13,
                fontWeight: isSelected ? 600 : 400,
                color: isSelected ? "#111827" : "#9ca3af",
                cursor: "pointer", userSelect: "none",
                transition: "all 0.1s", position: "relative", zIndex: 0,
              }}
            >{label}</div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Booking App ─────────────────────────────────────────────────────────
function BookingApp({ client, onLogout, clients, setClients, walkerProfiles = {} }) {
  // clients map is keyed by PIN — always use this key when writing back to the map
  const clientPinKey = client.pin
    || Object.keys(clients).find(k => clients[k]?.id === client.id)
    || String(client.id);

  const [page, setPage] = useState("overview");
  const [service, setService] = useState("dog");
  const [paymentBanner, setPaymentBanner] = useState(() => {
    try {
      const success = localStorage.getItem("dwi_payment_success");
      const cancelled = localStorage.getItem("dwi_payment_cancelled");
      const bookingConfirmed = localStorage.getItem("dwi_booking_confirmed");
      const bookingCancelled = localStorage.getItem("dwi_booking_cancelled");
      if (bookingConfirmed) { localStorage.removeItem("dwi_booking_confirmed"); return { type: "booking_confirmed" }; }
      if (bookingCancelled) { localStorage.removeItem("dwi_booking_cancelled"); return { type: "booking_cancelled" }; }
      if (success) {
        localStorage.removeItem("dwi_payment_success");
        try {
          const parsed = JSON.parse(success);
          if (parsed?.invoiceId) return { type: "success", ...parsed };
        } catch {}
        return { type: "success", invoiceId: success };
      }
      if (cancelled) { localStorage.removeItem("dwi_payment_cancelled"); return { type: "cancelled" }; }
    } catch {}
    return null;
  });

  // Auto-reload invoices when returning from successful payment
  useEffect(() => {
    if (paymentBanner?.type === "success") {
      loadInvoicesFromDB().then(invRows => {
        const fresh = { ...clients };
        Object.keys(fresh).forEach(cid => { fresh[cid] = { ...fresh[cid], invoices: [] }; });
        invRows.forEach(inv => {
          if (fresh[inv._clientId]) {
            const { _clientId, ...invData } = inv;
            fresh[inv._clientId].invoices = [...(fresh[inv._clientId].invoices || []), invData];
          }
        });
        setClients(fresh);
      });
      // Auto-dismiss success banner after 20 seconds
      const timer = setTimeout(() => setPaymentBanner(null), 20000);
      return () => clearTimeout(timer);
    }
    // Auto-dismiss booking confirmed banner after 10 seconds
    if (paymentBanner?.type === "booking_confirmed") {
      const timer = setTimeout(() => setPaymentBanner(null), 10000);
      return () => clearTimeout(timer);
    }
  }, [paymentBanner]);

  // ── Contact Us form state ──
  const [contactForm, setContactForm] = useState({ subject: "", message: "", contactPref: "email" });
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);

  // ── Client ↔ Walker messaging state ──
  const [clientMsgs, setClientMsgs]       = useState([]);
  const [clientMsgLoading, setClientMsgLoading] = useState(false);
  const [clientMsgInput, setClientMsgInput]     = useState("");
  const clientMsgPollRef      = useRef(null);
  const clientMsgBottomRef    = useRef(null);
  const clientMsgContainerRef = useRef(null);
  const [clientMsgLastSeen, setClientMsgLastSeen] = useState(() => {
    try { return localStorage.getItem(`dwi_client_msg_seen_${client.email}`) || ""; } catch { return ""; }
  });

  // Overnight booking state
  const [overnightLocation, setOvernightLocation] = useState("ours");
  const [overnightDate, setOvernightDate] = useState("");
  const [overnightNotes, setOvernightNotes] = useState("");
  const [overnightWalker, setOvernightWalker] = useState(client.preferredWalker || "");
  const overnightWalkerRef = useRef(null);
  const [overnightStep, setOvernightStep] = useState("pick"); // "pick" | "confirm"
  const [overnightSubmitting, setOvernightSubmitting] = useState(false);
  // Calculate minimum week offset based on meet & greet date
  const handoffDate = client.handoffInfo?.handoffDate ? new Date(client.handoffInfo.handoffDate) : null;
  const handoffMidnight = handoffDate ? new Date(handoffDate.getFullYear(), handoffDate.getMonth(), handoffDate.getDate()) : null;
  const minWeekOffset = (() => {
    if (!handoffMidnight) return 0;
    const todayMonday = getWeekDates(0)[0];
    todayMonday.setHours(0, 0, 0, 0);
    for (let w = 0; w <= 8; w++) {
      const weekEnd = getWeekDates(w)[6];
      weekEnd.setHours(23, 59, 59, 999);
      if (handoffMidnight <= weekEnd) return w;
    }
    return 0;
  })();
  const [weekOffset, setWeekOffset] = useState(minWeekOffset);
  // Single-day booking — no multi-day Set needed
  const [activeDay, setActiveDay] = useState(() => {
    const startDates = getWeekDates(minWeekOffset);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDates[i]); d.setHours(0, 0, 0, 0);
      if (d >= today && (!handoffMidnight || d >= handoffMidnight)) return i;
    }
    return 0;
  });
  // Single walk selection for the active day
  const [selectedWalk, setSelectedWalk] = useState({ slotId: "", duration: "30 min" });
  // Aliases for minimal diff with rest of code
  const selectedWalks = [selectedWalk];
  const setSelectedWalks = (fn) => {
    const next = typeof fn === "function" ? fn([selectedWalk]) : fn;
    setSelectedWalk(next[0] || { slotId: "", duration: "30 min" });
  };
  const selectedDay = activeDay;
  const walksByDay = { [activeDay]: [selectedWalk] };
  const weekDates = getWeekDates(weekOffset);
  const dateStr = (i) => dateStrFromDate(weekDates[i]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [step, setStep] = useState("pick");
  const savedDogs = client.dogs || client.pets || [];
  const savedCats = client.cats || [];
  const savedPets = service === "dog" ? savedDogs : savedCats;
  const [form, setForm] = useState({ name: client.name || "", pet: (service === "dog" ? savedDogs : savedCats).slice(-1)[0] || "", email: client.email, phone: client.phone || "", address: client.address || "", addrObj: client.addrObj || addrFromString(client.address || ""), walker: client.preferredWalker || "", notes: client.notes || "" });
  const [additionalDogs, setAdditionalDogs] = useState([]);
  const [isRecurring, setIsRecurring] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [payingBookingKey, setPayingBookingKey] = useState(null); // prevents double-click on Pay Now buttons
  const [expandedWalker, setExpandedWalker] = useState(null);
  const [cancelConfirm, setCancelConfirm] = useState(null);
  const [cancelResult, setCancelResult] = useState(null); // { booking, refundAmount, refundPercent, hoursUntilWalk, bookingPrice }
  const [handoffEditOpen, setHandoffEditOpen] = useState(false);
  const [showCancelBanner, setShowCancelBanner] = useState(false); // only shown after a cancellation in this session
  const [cancelBannerFading, setCancelBannerFading] = useState(false);
  const [cancelBannerProgress, setCancelBannerProgress] = useState(100);
  useEffect(() => {
    if (!showCancelBanner) return;
    setCancelBannerFading(false);
    setCancelBannerProgress(100);
    const duration = 5000;
    const interval = 30;
    const steps = duration / interval;
    let step = 0;
    const progressTimer = setInterval(() => {
      step++;
      setCancelBannerProgress(Math.max(0, 100 - (step / steps) * 100));
    }, interval);
    const fadeTimer = setTimeout(() => setCancelBannerFading(true), duration - 500);
    const hideTimer = setTimeout(() => { setShowCancelBanner(false); setCancelBannerProgress(100); }, duration);
    return () => { clearInterval(progressTimer); clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [showCancelBanner]);
  const [handoffCancelConfirm, setHandoffCancelConfirm] = useState(false);
  const [handoffReschedDay, setHandoffReschedDay] = useState(null);
  const [handoffReschedWindow, setHandoffReschedWindow] = useState(null);
  const [handoffReschedWeek, setHandoffReschedWeek] = useState(0);
  const hasBookings = (client.bookings || []).filter(b => !b.cancelled).length > 0;
  const [showHandoffBanner, setShowHandoffBanner] = useState(!hasBookings);
  useEffect(() => {
    if (!showHandoffBanner) return;
    const t = setTimeout(() => setShowHandoffBanner(false), 5000);
    return () => clearTimeout(t);
  }, []);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [recurringCancelConfirm, setRecurringCancelConfirm] = useState(null);
  const [walksSearch, setWalksSearch] = useState("");
  const [invoicesSearch, setInvoicesSearch] = useState("");
  const [messagesSearch, setMessagesSearch] = useState("");

  // Walker availability loaded from Supabase — keyed by walkerId then dateKey
  const [walkerAvailability, setWalkerAvailability] = useState({});
  const preferredWalkerRef = useRef(null);
  const [cancelling, setCancelling] = useState(false); // prevents double-fire during cancel flow
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const fresh = await loadClients();
      if (fresh) setClients(fresh);
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    // Load availability for the visible 12-week window
    const start = toDateKey(getWeekDates(0)[0]);
    const end = toDateKey(getWeekDates(11)[6]);
    loadAllWalkersAvailability(start, end).then(data => setWalkerAvailability(data));
  }, []);

  // Scroll preferred walker into view when landing on the book page or switching service
  useEffect(() => {
    if (page === "book" && service !== "overnight") {
      setTimeout(() => preferredWalkerRef.current?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }), 300);
    }
    if (page === "book" && service === "overnight") {
      setTimeout(() => overnightWalkerRef.current?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }), 300);
    }
  }, [page, service]);

  // Get available slots for selected walker on selected day
  const selectedDateKey = toDateKey(weekDates[selectedDay]);
  const selectedWalkerObj = getAllWalkers(walkerProfiles).find(w => w.name === form.walker);
  // walkerSlotsForDay:
  //   null  = no walker selected → show all slots (unfiltered)
  //   []    = walker selected but unavailable this day (either set no slots for day, or no availability at all) → warning, no slots
  //   [...] = walker is available these specific slots → filter to those
  const walkerHasAnyAvailability = selectedWalkerObj
    ? Object.keys(walkerAvailability[selectedWalkerObj.id] || {}).length > 0
    : false;
  const walkerSlotsForDay = selectedWalkerObj
    ? (walkerHasAnyAvailability
        ? (walkerAvailability[selectedWalkerObj.id]?.[selectedDateKey] ?? [])
        : [])
    : null;

  const svc = SERVICES[service];
  const myBookings = client.bookings || [];

  // ── Client notification / last-seen tracking ────────────────────────────────
  const [clientSeenTs, setClientSeenTs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dwi_client_seen_${client.id}`) || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    setClientSeenTs(prev => {
      const updated = { ...prev, [`${page}At`]: new Date().toISOString() };
      localStorage.setItem(`dwi_client_seen_${client.id}`, JSON.stringify(updated));
      return updated;
    });
  }, [page]);

  // My Walks: walks newly confirmed by walker or completed by admin since last viewed
  const mywalksSeen = clientSeenTs["mywalksAt"] ? new Date(clientSeenTs["mywalksAt"]) : null;
  const clientMywalksBadge = mywalksSeen
    ? myBookings.filter(b => {
        if (b.cancelled) return false;
        if (b.walkerConfirmed && b.walkerConfirmedAt && new Date(b.walkerConfirmedAt) > mywalksSeen) return true;
        if (b.adminCompleted && b.completedAt && new Date(b.completedAt) > mywalksSeen) return true;
        return false;
      }).length
    : 0;

  const clientNotifCounts = { mywalks: clientMywalksBadge };

  // ── Client message polling, unread badge, send ──
  // Background poll: always runs so the badge stays fresh on other tabs
  const clientMsgBgPollRef = useRef(null);
  useEffect(() => {
    if (!client.keyholder) return;
    loadClientMessages(client.email, client.keyholder).then(setClientMsgs);
    clientMsgBgPollRef.current = setInterval(() => {
      if (page !== "messages") {
        loadClientMessages(client.email, client.keyholder).then(setClientMsgs);
      }
    }, 30000);
    return () => { if (clientMsgBgPollRef.current) clearInterval(clientMsgBgPollRef.current); };
  }, []);

  // Active poll: fast refresh only while on the messages tab
  useEffect(() => {
    if (page === "messages" && client.keyholder) {
      const now = new Date().toISOString();
      setClientMsgLastSeen(now);
      try { localStorage.setItem(`dwi_client_msg_seen_${client.email}`, now); } catch {}
      setClientMsgLoading(true);
      loadClientMessages(client.email, client.keyholder).then(msgs => { setClientMsgs(msgs); setClientMsgLoading(false); });
      clientMsgPollRef.current = setInterval(() => {
        loadClientMessages(client.email, client.keyholder).then(setClientMsgs);
      }, 8000);
    } else {
      if (clientMsgPollRef.current) { clearInterval(clientMsgPollRef.current); clientMsgPollRef.current = null; }
    }
    return () => { if (clientMsgPollRef.current) { clearInterval(clientMsgPollRef.current); clientMsgPollRef.current = null; } };
  }, [page]);

  useEffect(() => {
    const el = clientMsgContainerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      clientMsgBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [clientMsgs]);

  const unreadClientMsgCount = client.keyholder
    ? clientMsgs.filter(m => m.from !== client.name && m.sentAt &&
        (!clientMsgLastSeen || new Date(m.sentAt) > new Date(clientMsgLastSeen))).length
    : 0;

  const sendClientMsg = async () => {
    if (!clientMsgInput.trim() || !client.keyholder) return;
    const text = clientMsgInput.trim();
    setClientMsgInput("");
    const tempMsg = { id: `tmp-${Date.now()}`, from: client.name, text, sentAt: new Date().toISOString(), time: "Just now" };
    setClientMsgs(m => [...m, tempMsg]);
    await saveClientMessage(client.email, client.keyholder, client.name, text);
    loadClientMessages(client.email, client.keyholder).then(setClientMsgs);
  };

  // Old Walks — which week rows are expanded
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const toggleWeek = (key) => setExpandedWeeks(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const clientNotifCountsFull = { ...clientNotifCounts, messages: unreadClientMsgCount,
    invoices: (client.invoices || []).filter(inv => {
      const { effectiveStatus } = invoiceStatusMeta(inv.status, inv.dueDate);
      return effectiveStatus === "sent" || effectiveStatus === "overdue";
    }).length,
  };

  // Block out the walker's already-booked time + 30-min travel buffer on the selected day.
  // For a 30-min walk: blocks the walk slot + the following 30-min buffer (60 min total).
  // For a 60-min walk: blocks both walk slots + the following 30-min buffer (90 min total).
  const walkerBookedMins = (() => {
    if (!selectedWalkerObj) return new Set();
    const blocked = new Set();
    Object.values(clients).forEach(c => {
      (c.bookings || []).forEach(b => {
        if (b.cancelled || b.adminCompleted) return;
        if (b.form?.walker !== selectedWalkerObj.name) return;
        if (!b.scheduledDateTime?.startsWith(selectedDateKey)) return;
        const dt = new Date(b.scheduledDateTime);
        const startMins    = dt.getHours() * 60 + dt.getMinutes();
        const durationMins = b.slot?.duration === "60 min" ? 60 : 30;
        const endMins      = startMins + durationMins + 30; // duration + 30 min travel buffer
        for (let m = startMins; m < endMins; m += 30) blocked.add(m);
      });
    });
    return blocked;
  })();


  // Auto-load map if client already has a saved address

  const bookingKey = (svcId, day, slotId) => {
    const d = weekDates[day];
    const dateKey = d.toISOString().slice(0, 10);
    return `${svcId}-${dateKey}-${slotId}`;
  };
  const isBooked = (slotId) => myBookings.some(b => b.key === bookingKey(service, selectedDay, slotId) && !b.cancelled);

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.pet.trim()) e.pet = "Required";
    if (!form.email.trim() || !form.email.includes("@")) e.email = "Valid email required";
    if (!form.address.trim()) e.address = "Required";
    if (!client.phone && !form.phone.trim()) e.phone = "Required for your first booking";
    return e;
  };

  // Whether this service requires upfront payment (meet & greet is free)
  const requiresPayment = service !== "meet-greet";

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSubmitting(true);
    setSubmitError("");
    await new Promise(r => setTimeout(r, 800));
    try {
      const newBookings = [];

      // Single day, single walk booking
      const slot = svc.slots.find(s => s.id === selectedWalk.slotId);
      if (slot && selectedWalk.duration) {
        const apptDate = new Date(weekDates[activeDay]);
        const [timePart, meridiem] = slot.time.split(" ");
        let [hours, minutes] = timePart.split(":").map(Number);
        if (meridiem === "PM" && hours !== 12) hours += 12;
        if (meridiem === "AM" && hours === 12) hours = 0;
        apptDate.setHours(hours, minutes || 0, 0, 0);
        newBookings.push({
          key: bookingKey(service, activeDay, slot.id),
          service, day: FULL_DAYS[activeDay], date: dateStrFromDate(weekDates[activeDay]),
          slot: { ...slot, duration: selectedWalk.duration },
          form: { ...form, additionalDogs }, bookedAt: new Date().toISOString(),
          scheduledDateTime: apptDate.toISOString(),
          additionalDogCount: additionalDogs.length,
          additionalDogCharge: additionalDogs.length * 10,
          price: 0, priceTier: "",
          // Stamp recurringId so the My Walks dedup check suppresses the synthesized
          // instance for this week and avoids showing the same walk twice.
          ...(isRecurring ? { recurringId: `rec_${service}_${activeDay}_${slot.id}` } : {}),
        });
      }

      // Append new bookings then reprice
      const allBookings = repriceWeekBookings([...myBookings, ...newBookings]);

      // Save address, phone, and all dog/cat names back to client profile
      const petKey = service === "dog" ? "dogs" : "cats";
      const existingPets = client[petKey] || (service === "dog" ? (client.pets || []) : []);
      const allNewPetNames = [form.pet.trim(), ...additionalDogs.map(d => d.trim())].filter(Boolean);
      const mergedPets = [...existingPets];
      allNewPetNames.forEach(n => { if (!mergedPets.includes(n)) mergedPets.push(n); });

      // Recurring schedule — only for first walk on active day (single day, single walk)
      const existingRecurring = client.recurringSchedules || [];
      let updatedRecurring = existingRecurring;
      const activeDayWalks = (walksByDay[activeDay] || []).filter(w => w.slotId && w.duration);
      const primarySlot = svc.slots.find(s => s.id === activeDayWalks[0]?.slotId);
      if (isRecurring && primarySlot) {
        const recurringId = `rec_${service}_${activeDay}_${primarySlot.id}`;
        const newSchedule = {
          id: recurringId, service, dayOfWeek: activeDay,
          slotId: primarySlot.id, slotTime: primarySlot.time,
          duration: activeDayWalks[0].duration,
          form: { ...form, additionalDogs },
          additionalDogCount: additionalDogs.length,
          createdAt: new Date().toISOString(), cancelledWeeks: [],
        };
        updatedRecurring = [...existingRecurring.filter(r => r.id !== recurringId), newSchedule];
      }

      if (primarySlot) setSelectedSlot({ ...primarySlot, duration: activeDayWalks[0]?.duration });

      const updated = {
        ...client, bookings: allBookings,
        address: form.address || client.address || "",
        phone: form.phone || client.phone || "",
        preferredWalker: form.walker || client.preferredWalker || "",
        notes: form.notes || client.notes || "",
        recurringSchedules: updatedRecurring, [petKey]: mergedPets,
      };
      // For paid services: mark pending_payment and redirect to Stripe
      // For meet & greet (free): mark confirmed and go straight to confirm screen
      const bookingStatus = requiresPayment ? "pending_payment" : "confirmed";
      const bookingsWithStatus = allBookings.map(b =>
        newBookings.some(nb => nb.key === b.key)
          ? { ...b, status: bookingStatus }
          : b
      );
      const updatedWithStatus = { ...updated, bookings: bookingsWithStatus };
      const updatedClients = { ...clients, [clientPinKey]: updatedWithStatus };
      setClients(updatedClients);
      await saveClients(updatedClients);

      if (requiresPayment && newBookings.length > 0) {
        // Redirect to Stripe — emails fire after successful payment return
        const firstBooking = newBookings[0];
        const pricedBooking = bookingsWithStatus.find(b => b.key === firstBooking.key);
        const amount = pricedBooking?.price || 0;
        console.log("[BookingApp] Stripe checkout debug:", {
          firstBookingKey: firstBooking?.key,
          pricedBookingFound: !!pricedBooking,
          pricedBookingPrice: pricedBooking?.price,
          amount,
          allBookingsKeys: bookingsWithStatus.map(b => ({ key: b.key, price: b.price })),
        });
        try {
          localStorage.setItem("dwi_stripe_return_clientId", clientPinKey);
          localStorage.setItem("dwi_pending_booking_keys", JSON.stringify(newBookings.map(b => b.key)));
        } catch {}
        const { url } = await createBookingCheckout({
          clientId: clientPinKey,
          clientName: client.name,
          clientEmail: client.email,
          bookingKey: firstBooking.key,
          service,
          date: firstBooking.date,
          day: firstBooking.day,
          time: firstBooking.slot?.time || "—",
          duration: firstBooking.slot?.duration || "—",
          walker: form.walker || "",
          pet: form.pet,
          amount,
        });
        window.location.href = url;
        return;
      }

      // Free service (meet & greet) — send emails and show confirm screen
      const assignedWalkerObj = getAllWalkers(walkerProfiles).find(w => w.name === form.walker);
      newBookings.forEach(b => {
        sendBookingConfirmation({
          clientName: client.name, clientEmail: client.email,
          service, date: b.date, day: b.day,
          time: b.slot?.time || "—", duration: b.slot?.duration || "—",
          walker: form.walker || "", price: 0, pet: form.pet,
        });
        if (assignedWalkerObj?.email) {
          sendWalkerBookingNotification({
            walkerName: assignedWalkerObj.name, walkerEmail: assignedWalkerObj.email,
            clientName: client.name, pet: form.pet, service,
            date: b.date, day: b.day, time: b.slot?.time || "—",
            duration: b.slot?.duration || "—", price: 0,
          });
        }
        notifyAdmin("new_booking", {
          clientName: client.name, pet: form.pet,
          date: b.date, time: b.slot?.time || "—",
          duration: b.slot?.duration || "—",
          walker: form.walker || "Unassigned", price: 0,
        });
      });
      setSubmitting(false);
      setStep("confirm");
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err.message || "Something went wrong saving your booking. Please check your connection and try again.");
    }
  };

  // Shared date formatter used by My Walks list AND the booking detail sheet
  const fmtBookingDate = (dt) => {
    if (!dt) return "";
    const [y, m, d] = dt.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  };

  const handleReset = () => {
    setStep("pick"); setSelectedSlot(null);
    const pets = service === "dog" ? savedDogs : savedCats;
    setForm({ name: client.name || "", pet: pets.slice(-1)[0] || "", email: client.email, phone: client.phone || "", address: client.address || "", addrObj: client.addrObj || addrFromString(client.address || ""), walker: client.preferredWalker || "", notes: client.notes || "" });
    setAdditionalDogs([]);
    setSelectedWalk({ slotId: "", duration: "30 min" });
    setIsRecurring(false);
    setErrors({});
  };

  // ── Pay for unpaid first walk (booked by walker during handoff) ──
  const handlePayFirstWalk = async (booking) => {
    if (payingBookingKey) return; // prevent double-click
    setPayingBookingKey(booking.key);
    try {
      try {
        localStorage.setItem("dwi_stripe_return_clientId", clientPinKey);
        localStorage.setItem("dwi_pending_booking_keys", JSON.stringify([booking.key]));
      } catch {}
      const { url } = await createBookingCheckout({
        clientId: clientPinKey,
        clientName: client.name,
        clientEmail: client.email,
        bookingKey: booking.key,
        service: booking.service || "dog",
        date: booking.date || "",
        day: booking.day || "",
        time: booking.slot?.time || "—",
        duration: booking.slot?.duration || "—",
        walker: booking.form?.walker || "",
        pet: booking.form?.pet || "",
        amount: booking.price || 0,
      });
      window.location.href = url;
    } catch (err) {
      setPayingBookingKey(null);
      alert("Unable to open payment page. Please try again or contact us.");
    }
  };

  // ── Pay for an upcoming recurring walk (materializes it as a real pending booking) ──
  const handlePayRecurringInstance = async (instance) => {
    const bookingId = `rec_pay_${instance.recurringId}_${instance.recurringWeekKey}`;
    // Materialize as a real stored booking so Stripe return can stamp paidAt on it
    const newBooking = {
      key: bookingId,
      service: instance.service,
      day: instance.day,
      date: new Date(instance.scheduledDateTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      slot: instance.slot,
      form: instance.form,
      bookedAt: new Date().toISOString(),
      scheduledDateTime: instance.scheduledDateTime,
      price: instance.price,
      additionalDogCount: instance.additionalDogCount || 0,
      additionalDogCharge: (instance.additionalDogCount || 0) * 10,
      status: "pending_payment",
      isRecurringPending: true,
      recurringId: instance.recurringId,
      recurringWeekKey: instance.recurringWeekKey,
    };
    const allBookings = [...(client.bookings || []).filter(b => b.key !== bookingId), newBooking];
    const updated = { ...client, bookings: allBookings };
    const updatedClients = { ...clients, [clientPinKey]: updated };
    setClients(updatedClients);
    await saveClients(updatedClients);
    try {
      localStorage.setItem("dwi_stripe_return_clientId", clientPinKey);
      localStorage.setItem("dwi_pending_booking_keys", JSON.stringify([bookingId]));
    } catch {}
    try {
      const { url } = await createBookingCheckout({
        clientId: clientPinKey,
        clientName: client.name,
        clientEmail: client.email,
        bookingKey: bookingId,
        service: instance.service || "dog",
        date: new Date(instance.scheduledDateTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        day: instance.day || "",
        time: instance.slot?.time || "—",
        duration: instance.slot?.duration || "—",
        walker: instance.form?.walker || "",
        pet: instance.form?.pet || "",
        amount: instance.price || 0,
      });
      window.location.href = url;
    } catch {
      alert("Unable to open payment page. Please try again or contact us.");
    }
  };

  const handleCancel = async (cancelKey) => {
    if (cancelling) return; // already in-flight — block double-fire
    setCancelling(true);
    try {
    const booking = (client.bookings || []).find(b => b.key === cancelKey);
    if (!booking || booking.cancelled) { setCancelling(false); return; } // already cancelled
    const cancelledAt = new Date().toISOString();

    // ── Refund policy ────────────────────────────────────────────────────────
    // 24h+ before walk → 100% refund
    // 12–24h before walk → 50% refund
    // < 12h before walk → no refund
    //
    // Compute for ALL paid bookings (price > 0), not just Stripe bookings.
    // Stripe bookings get an automatic refund via the API; non-Stripe bookings
    // will show the owed amount in the email so admin can process it manually.
    let refundPercent = 0;
    let refundAmount = 0;
    let hoursUntilWalk = null;
    const bookingPrice = booking?.price || 0;
    // Require BOTH paidAt AND stripeSessionId — a booking stamped with paidAt
    // but no stripeSessionId means the Stripe session ID was lost in transit.
    // Without a session ID we can't issue a Stripe refund, so we don't treat
    // it as "paid" for refund-email purposes either.
    const wasActuallyPaid = !!(booking?.paidAt && booking?.stripeSessionId);
    if (bookingPrice > 0 && wasActuallyPaid) {
      // Prefer stored scheduledDateTime; otherwise reconstruct from date + slot.time
      let apptMs = null;
      if (booking.scheduledDateTime) {
        apptMs = new Date(booking.scheduledDateTime).getTime();
      } else if (booking.date && booking.slot?.time) {
        try {
          const [y, m, d] = booking.date.split("-").map(Number);
          const apptDate = new Date(y, (m || 1) - 1, d || 1);
          const [timePart, meridiem] = String(booking.slot.time).split(" ");
          let [hh, mm] = timePart.split(":").map(Number);
          if (meridiem === "PM" && hh !== 12) hh += 12;
          if (meridiem === "AM" && hh === 12) hh = 0;
          apptDate.setHours(hh || 0, mm || 0, 0, 0);
          apptMs = apptDate.getTime();
        } catch {}
      }
      if (apptMs != null) {
        hoursUntilWalk = (apptMs - Date.now()) / 3600000;
        if (hoursUntilWalk >= 24) refundPercent = 1.0;
        else if (hoursUntilWalk >= 12) refundPercent = 0.5;
      } else {
        // No timing info — default to full refund (benefit of the doubt)
        refundPercent = 1.0;
      }
      refundAmount = refundPercent > 0
        ? Math.round(bookingPrice * refundPercent * 100) / 100
        : 0;
    }
    console.log("[handleCancel] refund decision:", {
      bookingKey,
      hasStripeSessionId: !!booking?.stripeSessionId,
      stripeSessionId: booking?.stripeSessionId || null,
      paidAt: booking?.paidAt || null,
      scheduledDateTime: booking?.scheduledDateTime || null,
      fallbackDate: booking?.date,
      fallbackTime: booking?.slot?.time,
      hoursUntilWalk,
      price: booking?.price,
      refundPercent,
      refundAmount,
    });

    // Mark booking cancelled immediately (optimistic update)
    const cancelledBooking = {
      ...booking,
      cancelled: true,
      cancelledAt,
      ...(refundAmount > 0 ? { refundAmount, refundPercent } : {}),
    };
    const updatedBookings = repriceWeekBookings(
      client.bookings.map(b => b.key === cancelKey ? cancelledBooking : b)
    );

    // If this was a stored recurring booking, also mark its week as cancelled
    // so the dynamic recurring instance generator doesn't immediately respawn it.
    let updatedRecurringSchedules = client.recurringSchedules || [];
    if (booking.recurringId && booking.scheduledDateTime) {
      const d = new Date(booking.scheduledDateTime);
      const dow = d.getDay();
      const daysToMon = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(d);
      mon.setDate(d.getDate() + daysToMon);
      const weekKey = mon.toISOString().slice(0, 10);
      updatedRecurringSchedules = updatedRecurringSchedules.map(r =>
        r.id === booking.recurringId
          ? { ...r, cancelledWeeks: [...(r.cancelledWeeks || []), weekKey] }
          : r
      );
    }

    // Revoke any Lonestar Loyalty punch earned for this booking
    const cancelledClientData = { ...client, bookings: updatedBookings, recurringSchedules: updatedRecurringSchedules };
    const updated = revokePunchCard(cancelledClientData, cancelKey);
    const updatedClients = { ...clients, [clientPinKey]: updated };
    setClients(updatedClients);
    await saveClients(updatedClients);

    // Issue Stripe refund if owed
    // stripeRefundSucceeded tracks whether Stripe actually processed it (vs. admin handling manually)
    let stripeRefundSucceeded = false;
    let confirmedRefundAmount = 0;
    let stripeRefundId = null;
    let stripeReceiptUrl = null;
    if (refundAmount > 0 && booking?.stripeSessionId) {
      try {
        console.log("[handleCancel] calling createRefund", {
          stripeSessionId: booking.stripeSessionId,
          amount: refundPercent < 1 ? refundAmount : "FULL",
        });
        const result = await createRefund({
          stripeSessionId: booking.stripeSessionId,
          amount: refundPercent < 1 ? refundAmount : undefined, // omit for full refund
          reason: "requested_by_customer",
        });
        console.log("[handleCancel] createRefund result:", result);
        stripeRefundSucceeded = true;
        stripeRefundId = result?.refundId || null;
        stripeReceiptUrl = result?.receiptUrl || null;
        // Use Stripe's confirmed amount; fall back to computed if Stripe returns 0
        const stripeAmt = Number(result?.amount);
        confirmedRefundAmount = Number.isFinite(stripeAmt) && stripeAmt > 0 ? stripeAmt : refundAmount;
        // Persist refund ID + timestamp on booking
        if (stripeRefundId) {
          const withRefundId = {
            ...updated,
            bookings: updated.bookings.map(b =>
              b.key === cancelKey
                ? { ...b, refundId: stripeRefundId, refundedAt: new Date().toISOString(), refundAmount: confirmedRefundAmount, refundPercent }
                : b
            ),
          };
          const clientsWithRefund = { ...updatedClients, [clientPinKey]: withRefundId };
          setClients(clientsWithRefund);
          await saveClients(clientsWithRefund);
        }
      } catch (e) {
        console.error("[handleCancel] Refund failed:", e);
        // stripeRefundSucceeded stays false — admin will process manually
        // Still show the owed amount in the email so the client knows what to expect
      }
    } else if (booking?.stripeSessionId && refundAmount === 0) {
      console.log("[handleCancel] paid booking cancelled within no-refund window — skipping refund");
    }

    // Notify assigned walker and client
    if (booking) {
      const walkerName = booking.form?.walker || "";
      const walkerObj = getAllWalkers(walkerProfiles).find(w => w.name === walkerName);
      if (walkerObj?.email) {
        sendWalkerCancellationNotification({
          walkerName: walkerObj.name,
          walkerEmail: walkerObj.email,
          clientName: client.name,
          pet: booking.form?.pet || "",
          service: booking.service || booking.form?.service || "",
          date: booking.date || "",
          day: booking.day || "",
          time: booking.slot?.time || "—",
          duration: booking.slot?.duration || "—",
        });
      }
      // Send cancellation + refund confirmation to the client.
      // emailRefundAmount: Stripe-confirmed if processed, otherwise policy-computed (admin handles manually).
      const emailRefundAmount = stripeRefundSucceeded ? confirmedRefundAmount : refundAmount;
      if (client.email) {
        sendClientCancellationNotification({
          clientName: client.name,
          clientEmail: client.email,
          pet: booking.form?.pet || "",
          service: booking.service || booking.form?.service || "",
          date: booking.date || "",
          day: booking.day || "",
          time: booking.slot?.time || "—",
          duration: booking.slot?.duration || "—",
          walker: walkerName || "",
          refundAmount: emailRefundAmount,
          refundPercent: emailRefundAmount > 0 ? refundPercent : 0,
          isStripeRefund: stripeRefundSucceeded,
          refundId: stripeRefundId,
          receiptUrl: stripeReceiptUrl,
          bookingPrice: wasActuallyPaid ? bookingPrice : 0,
        });
      }
    }

    // Show the cancellation result screen with refund details
    const finalRefund = wasActuallyPaid
      ? (stripeRefundSucceeded ? confirmedRefundAmount : refundAmount)
      : 0;
    setCancelResult({
      booking,
      refundAmount: finalRefund,
      refundPercent: wasActuallyPaid ? refundPercent : 0,
      hoursUntilWalk,
      bookingPrice: wasActuallyPaid ? bookingPrice : 0,
      stripeRefundSucceeded,
      stripeRefundId,
    });
    } catch (err) {
      // Catch-all: ensure the cancel button never stays permanently stuck
      console.error("[handleCancel] unexpected error:", err);
      setSubmitError("Something went wrong cancelling this booking. Please try again.");
    } finally {
      setCancelling(false);
    }
  };


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f5f6f8" }}>
      <style>{GLOBAL_STYLES}</style>

      {/* ── Cancellation Result Screen ── */}
      {cancelResult && (() => {
        const { booking: cb, refundAmount: ra, refundPercent: rp, hoursUntilWalk: hw, bookingPrice: bp } = cancelResult;
        const wasPaid = bp > 0 && !!cb?.stripeSessionId;
        const refundLabel = rp >= 1 ? "Full refund" : rp >= 0.5 ? "50% refund" : "No refund";
        const windowLabel = hw == null
          ? "Refund issued"
          : hw >= 24
          ? "Cancelled 24+ hours in advance"
          : hw >= 12
          ? "Cancelled 12–24 hours in advance"
          : "Cancelled within 12 hours";
        const refundColor = ra > 0 ? "#15803d" : "#dc2626";
        const refundBg = ra > 0 ? "#f0fdf4" : "#fef2f2";
        const refundBorder = ra > 0 ? "#bbf7d0" : "#fecaca";
        return (
          <div style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "#0B1423",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "16px",
            fontFamily: "'DM Sans', sans-serif",
          }}>
            <div style={{
              background: "#111827", borderRadius: "18px",
              padding: "20px 18px", maxWidth: "400px", width: "100%",
              border: "1.5px solid #1f2937",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}>
              {/* Icon + heading */}
              <div style={{ textAlign: "center", marginBottom: "14px" }}>
                <div style={{ fontSize: "30px", marginBottom: "6px" }}>🚫</div>
                <div style={{ fontWeight: 700, fontSize: "18px", color: "#fff", marginBottom: "2px" }}>
                  Appointment Cancelled
                </div>
                <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                  {cb?.form?.pet ? `We'll miss ${cb.form.pet}!` : "Your walk has been cancelled."}
                </div>
              </div>

              {/* Appointment details */}
              <div style={{
                background: "#1f2937", borderRadius: "10px",
                padding: "12px 14px", marginBottom: "10px",
                border: "1px solid #374151",
              }}>
                <div style={{ fontWeight: 600, fontSize: "10px", color: "#6b7280",
                  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                  Cancelled Appointment
                </div>
                {cb?.form?.pet && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <span style={{ color: "#9ca3af", fontSize: "13px" }}>Pet</span>
                    <span style={{ color: "#fff", fontSize: "13px", fontWeight: 500 }}>{cb.form.pet}</span>
                  </div>
                )}
                {cb?.date && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <span style={{ color: "#9ca3af", fontSize: "13px" }}>Date</span>
                    <span style={{ color: "#fff", fontSize: "13px", fontWeight: 500 }}>
                      {cb.day ? `${cb.day}, ` : ""}{cb.date}
                    </span>
                  </div>
                )}
                {cb?.slot?.time && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <span style={{ color: "#9ca3af", fontSize: "13px" }}>Time</span>
                    <span style={{ color: "#fff", fontSize: "13px", fontWeight: 500 }}>{cb.slot.time}</span>
                  </div>
                )}
                {cb?.slot?.duration && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <span style={{ color: "#9ca3af", fontSize: "13px" }}>Duration</span>
                    <span style={{ color: "#fff", fontSize: "13px", fontWeight: 500 }}>{cb.slot.duration}</span>
                  </div>
                )}
                {cb?.form?.walker && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#9ca3af", fontSize: "13px" }}>Walker</span>
                    <span style={{ color: "#fff", fontSize: "13px", fontWeight: 500 }}>{cb.form.walker}</span>
                  </div>
                )}
              </div>

              {/* Refund details */}
              <div style={{
                background: refundBg, borderRadius: "10px",
                padding: "12px 14px", marginBottom: "14px",
                border: `1px solid ${refundBorder}`,
              }}>
                <div style={{ fontWeight: 600, fontSize: "10px", color: refundColor,
                  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                  Refund Summary
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                  <span style={{ color: "#374151", fontSize: "13px" }}>Original charge</span>
                  <span style={{ color: "#111827", fontSize: "13px", fontWeight: 500 }}>
                    ${bp > 0 ? bp.toFixed(2) : "—"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                  <span style={{ color: "#374151", fontSize: "13px" }}>Policy</span>
                  <span style={{ color: "#374151", fontSize: "13px", fontWeight: 500 }}>{windowLabel}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  paddingTop: "8px", borderTop: `1px solid ${refundBorder}` }}>
                  <span style={{ color: "#111827", fontSize: "14px", fontWeight: 700 }}>
                    {refundLabel}
                  </span>
                  <span style={{ color: refundColor, fontSize: "18px", fontWeight: 700 }}>
                    {ra > 0 ? `$${ra.toFixed(2)}` : "$0.00"}
                  </span>
                </div>
                {ra > 0 && wasPaid && (
                  <div style={{ marginTop: "6px", fontSize: "11px", color: "#15803d", textAlign: "center" }}>
                    Refund submitted to your original payment method. Allow 5–10 business days.
                  </div>
                )}
                {ra > 0 && !wasPaid && (
                  <div style={{ marginTop: "6px", fontSize: "11px", color: "#b45309", textAlign: "center" }}>
                    A refund of ${ra.toFixed(2)} will be processed by our team.
                  </div>
                )}
                {ra === 0 && bp > 0 && (
                  <div style={{ marginTop: "6px", fontSize: "11px", color: "#dc2626", textAlign: "center" }}>
                    No refund applies — cancellation was within 12 hours of the appointment.
                  </div>
                )}
                {bp === 0 && (
                  <div style={{ marginTop: "6px", fontSize: "11px", color: "#6b7280", textAlign: "center" }}>
                    No charge was applied to this appointment.
                  </div>
                )}
              </div>

              {/* CTA */}
              <button
                onClick={() => { setCancelResult(null); setShowCancelBanner(true); }}
                style={{
                  width: "100%", padding: "13px", borderRadius: "11px", border: "none",
                  background: "#C4541A", color: "#fff",
                  fontSize: "15px", fontWeight: 600, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                Back to My Walks
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Cancel toast banner (fixed top) ── */}
      {showCancelBanner && (() => {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recentCancels = (client.bookings || []).filter(b =>
          b.cancelled && b.cancelledAt && new Date(b.cancelledAt) >= sevenDaysAgo
        );
        const pet = recentCancels[0]?.form?.pet || recentCancels[0]?.pet || null;
        const dismiss = () => { setCancelBannerFading(true); setTimeout(() => setShowCancelBanner(false), 400); };
        return (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
            display: "flex", justifyContent: "center",
            padding: "12px 16px 0",
            pointerEvents: "none",
            opacity: cancelBannerFading ? 0 : 1,
            transform: cancelBannerFading ? "translateY(-20px)" : "translateY(0)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
          }}>
            <div style={{
              pointerEvents: "auto",
              background: "#1a1a1a",
              borderRadius: "14px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.12)",
              padding: "0",
              maxWidth: "460px",
              width: "100%",
              overflow: "hidden",
            }}>
              {/* Main content row */}
              <div style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "13px 14px 13px 16px",
              }}>
                {/* Icon circle */}
                <div style={{
                  width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                  background: "linear-gradient(135deg, #C4541A, #f59e0b)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "17px",
                }}>🐾</div>

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                    fontSize: "14px", color: "#ffffff", lineHeight: 1.3,
                    marginBottom: "2px" }}>
                    {pet ? `We'll miss ${pet}!` : "Walk cancelled"}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif",
                    fontSize: "13px", color: "rgba(255,255,255,0.55)", lineHeight: 1.3 }}>
                    Ready to hit the trail again?{" "}
                    <button onClick={() => { dismiss(); setPage("book"); }}
                      style={{ background: "none", border: "none", cursor: "pointer",
                        color: "#f59e0b", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "13px", fontWeight: 700, padding: 0 }}>
                      Book a walk →
                    </button>
                  </div>
                </div>

                {/* Close button */}
                <button onClick={dismiss}
                  style={{ background: "rgba(255,255,255,0.08)", border: "none", cursor: "pointer",
                    color: "rgba(255,255,255,0.5)", fontSize: "13px", flexShrink: 0,
                    width: "26px", height: "26px", borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
                  onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}>
                  ✕
                </button>
              </div>

              {/* Progress bar */}
              <div style={{ height: "3px", background: "rgba(255,255,255,0.08)" }}>
                <div style={{
                  height: "100%",
                  width: `${cancelBannerProgress}%`,
                  background: "linear-gradient(90deg, #C4541A, #f59e0b)",
                  transition: "width 0.03s linear",
                }} />
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ flex: 1, overflowY: "scroll", WebkitOverflowScrolling: "touch" }}>
      <Header client={client} onLogout={onLogout} />
      <ClientNav client={client} onLogout={onLogout} page={page} setPage={setPage} notifCounts={clientNotifCountsFull} onRefresh={handleRefresh} refreshing={refreshing} sticky />

      {/* ── Meet & Greet Cancel Confirm ── */}
      {handoffCancelConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div className="fade-up" style={{ background: "#fff", borderRadius: "18px", padding: "28px 24px",
            maxWidth: "360px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", textAlign: "center" }}>
            <div style={{ fontSize: "36px", marginBottom: "12px" }}>🤝</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600,
              color: "#111827", marginBottom: "8px" }}>Cancel Meet & Greet?</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
              lineHeight: "1.6", marginBottom: "24px" }}>
              Your meet & greet appointment will be removed. You can schedule a new one from the Book page.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button onClick={() => {
                // Keep handoffDone: true so the client stays in BookingApp.
                // Just clear handoffInfo — they'll re-book a meet & greet from the Book page.
                const updated = { ...client, handoffInfo: null };
                const updatedClients = { ...clients, [clientPinKey]: updated };
                setClients(updatedClients);
                saveClients(updatedClients);
                setHandoffCancelConfirm(false);
              }} style={{ width: "100%", padding: "13px", borderRadius: "10px", border: "none",
                background: "#dc2626", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
                Yes, Cancel Appointment
              </button>
              <button onClick={() => setHandoffCancelConfirm(false)}
                style={{ width: "100%", padding: "13px", borderRadius: "10px",
                  border: "1.5px solid #e4e7ec", background: "#fff",
                  color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", cursor: "pointer" }}>
                Keep It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Meet & Greet Schedule / Reschedule Modal ── */}
      {handoffEditOpen && (() => {
        const purple = "#7A4D6E";
        const wDates = getWeekDates(handoffReschedWeek);
        const canSave = handoffReschedDay !== null && handoffReschedWindow !== null;
        const isNewBooking = !client.handoffInfo?.handoffDate;
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div className="fade-up" style={{ background: "#fff", borderRadius: "20px 20px 0 0",
              width: "100%", maxWidth: "520px", maxHeight: "90vh", overflowY: "auto",
              padding: "28px 20px 40px", boxShadow: "0 -8px 40px rgba(0,0,0,0.2)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase",
                  letterSpacing: "1.5px", fontWeight: 700, color: "#111827" }}>
                  {isNewBooking ? "Schedule Meet & Greet" : "Reschedule Meet & Greet"}
                </div>
                <button onClick={() => setHandoffEditOpen(false)} style={{ background: "none", border: "none",
                  color: "#9ca3af", fontSize: "22px", cursor: "pointer" }}>✕</button>
              </div>

              {/* Week nav */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <button onClick={() => { if (handoffReschedWeek > 0) { setHandoffReschedWeek(w => w - 1); setHandoffReschedDay(null); setHandoffReschedWindow(null); } }}
                  disabled={handoffReschedWeek === 0}
                  style={{ width: "32px", height: "32px", borderRadius: "8px", border: "1.5px solid #e4e7ec",
                    background: handoffReschedWeek === 0 ? "#f9fafb" : "#fff",
                    color: handoffReschedWeek === 0 ? "#d1d5db" : "#374151", cursor: handoffReschedWeek === 0 ? "default" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
                  {handoffReschedWeek === 0 ? "This week" : handoffReschedWeek === 1 ? "Next week" : `+${handoffReschedWeek} weeks`}
                </div>
                <button onClick={() => { setHandoffReschedWeek(w => w + 1); setHandoffReschedDay(null); setHandoffReschedWindow(null); }}
                  disabled={handoffReschedWeek >= 8}
                  style={{ width: "32px", height: "32px", borderRadius: "8px", border: "1.5px solid #e4e7ec",
                    background: handoffReschedWeek >= 8 ? "#f9fafb" : "#fff",
                    color: handoffReschedWeek >= 8 ? "#d1d5db" : "#374151", cursor: handoffReschedWeek >= 8 ? "default" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
              </div>

              {/* Day selector Mon–Fri */}
              <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
                {[0,1,2,3,4].map(i => {
                  const date = wDates[i];
                  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
                  // Disable day if even the last slot (7 PM) falls within the 24-hour gate
                  const lastSlotOfDay = new Date(date);
                  lastSlotOfDay.setHours(19, 0, 0, 0);
                  const disabled = lastSlotOfDay <= cutoff;
                  const active = handoffReschedDay === i;
                  return (
                    <button key={i} onClick={() => { if (!disabled) { setHandoffReschedDay(i); setHandoffReschedWindow(null); } }}
                      disabled={disabled}
                      style={{ flex: 1, padding: "10px 4px", borderRadius: "10px",
                        border: active ? `2px solid ${purple}` : "2px solid #e4e7ec",
                        background: active ? purple : disabled ? "#f9fafb" : "#fff",
                        color: active ? "#fff" : disabled ? "#d1d5db" : "#374151",
                        cursor: disabled ? "default" : "pointer",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
                        fontFamily: "'DM Sans', sans-serif" }}>
                      <span style={{ fontSize: "13px", fontWeight: 600, textTransform: "uppercase" }}>{DAYS[i]}</span>
                      <span style={{ fontSize: "15px", fontWeight: 700 }}>{date.getDate()}</span>
                    </button>
                  );
                })}
              </div>

              {/* Time window */}
              {handoffReschedDay !== null && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
                  {ALL_HANDOFF_SLOTS.filter(slot => {
                    const slotTime = new Date(wDates[handoffReschedDay]);
                    slotTime.setHours(slot.hour, slot.minute, 0, 0);
                    return slotTime > new Date(Date.now() + 24 * 60 * 60 * 1000);
                  }).map(slot => {
                    const active = handoffReschedWindow?.id === slot.id;
                    return (
                      <button key={slot.id} onClick={() => setHandoffReschedWindow(slot)}
                        style={{ padding: "16px 12px", borderRadius: "12px", cursor: "pointer",
                          border: active ? `2px solid ${purple}` : "1.5px solid #e4e7ec",
                          background: active ? "#F5EFF3" : "#fff",
                          color: active ? purple : "#374151",
                          textAlign: "center", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }}>
                        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "3px" }}>{slot.label}</div>
                        <div style={{ fontSize: "12px", color: active ? purple : "#9ca3af" }}>15-min meet & greet</div>
                      </button>
                    );
                  })}
                </div>
              )}

              <button disabled={!canSave} onClick={() => {
                const newDate = new Date(wDates[handoffReschedDay]);
                newDate.setHours(handoffReschedWindow.hour, handoffReschedWindow.minute, 0, 0);

                // Compute new follow-on start time (meet & greet + 15 min)
                const foTotalMins = handoffReschedWindow.hour * 60 + handoffReschedWindow.minute + 15;
                const foH = Math.floor(foTotalMins / 60);
                const foM = foTotalMins % 60;
                const foHour12 = foH > 12 ? foH - 12 : foH === 0 ? 12 : foH;
                const foAmpm = foH < 12 ? "AM" : "PM";
                const foMStr = foM === 0 ? "00" : foM === 15 ? "15" : foM === 30 ? "30" : "45";
                const foTimeLabel = `${foHour12}:${foMStr} ${foAmpm}`;
                const foDate = new Date(newDate);
                foDate.setHours(foH, foM, 0, 0);

                // Update the isFirstWalk booking if one exists
                const existingBookings = client.bookings || [];
                const updatedBookings = existingBookings.map(b => {
                  if (!b.isFirstWalk) return b;
                  return {
                    ...b,
                    day: FULL_DAYS[handoffReschedDay],
                    date: dateStrFromDate(foDate),
                    slot: { ...b.slot, time: foTimeLabel },
                    scheduledDateTime: foDate.toISOString(),
                  };
                });

                // Also update followOnWalk metadata on handoffInfo
                const existingFollowOn = client.handoffInfo?.followOnWalk;
                const updatedFollowOn = existingFollowOn ? {
                  ...existingFollowOn,
                  slotTime: foTimeLabel,
                  hour: foH,
                  minute: foM,
                  dayOfWeek: handoffReschedDay,
                  date: foDate.toISOString(),
                } : existingFollowOn;

                const updated = {
                  ...client,
                  bookings: updatedBookings,
                  handoffInfo: {
                    ...client.handoffInfo,
                    handoffDay: handoffReschedDay,
                    handoffSlot: handoffReschedWindow,
                    handoffDate: newDate.toISOString(),
                    // Preserve or default the walker when creating a new booking after cancellation
                    handoffWalker: client.handoffInfo?.handoffWalker || client.preferredWalker || "",
                    ...(updatedFollowOn !== undefined ? { followOnWalk: updatedFollowOn } : {}),
                  },
                };
                const updatedClients = { ...clients, [clientPinKey]: updated };
                setClients(updatedClients);
                saveClients(updatedClients);
                setHandoffEditOpen(false);
                setHandoffReschedDay(null);
                setHandoffReschedWindow(null);
                setHandoffReschedWeek(0);
              }} style={{ width: "100%", padding: "15px", borderRadius: "12px", border: "none",
                background: canSave ? purple : "#e4e7ec",
                color: canSave ? "#fff" : "#9ca3af",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600,
                cursor: canSave ? "pointer" : "default", transition: "all 0.15s" }}>
                {canSave ? (isNewBooking ? "Confirm Appointment" : "Confirm Reschedule") : "Select a day and window"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Payment result banner */}
      {paymentBanner && (() => {
        // Look up the invoice amount from client data
        const paidInvoice = paymentBanner.invoiceId
          ? (client?.invoices || []).find(inv => inv.id === paymentBanner.invoiceId)
          : null;
        const amount   = paidInvoice?.total != null ? `$${paidInvoice.total}` : null;
        const paidDate = paymentBanner.paidAt
          ? new Date(paymentBanner.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : null;
        const brandLabel = paymentBanner.brand
          ? paymentBanner.brand.charAt(0).toUpperCase() + paymentBanner.brand.slice(1)
          : "Card";
        const cardLine = paymentBanner.last4
          ? `${brandLabel} ending in ${paymentBanner.last4}`
          : "Stripe";

        if (paymentBanner.type === "booking_confirmed") return (
          <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: "12px",
            margin: "16px 16px 0", padding: "14px 18px", display: "flex",
            alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
              <span style={{ fontSize: "20px", marginTop: "1px" }}>🐾</span>
              <div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#15803d", fontWeight: 600, marginBottom: "4px" }}>
                  Booking confirmed & payment received!
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#6b7280" }}>
                  You'll receive a confirmation email shortly. See you soon! 🐶
                </div>
              </div>
            </div>
            <button onClick={() => setPaymentBanner(null)} style={{ background: "none", border: "none",
              cursor: "pointer", color: "#9ca3af", fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
        );
        if (paymentBanner.type === "booking_cancelled") return (
          <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: "12px",
            margin: "16px 16px 0", padding: "14px 18px", display: "flex",
            alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>❌</span>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#dc2626", fontWeight: 600 }}>
                Booking cancelled — your card was not charged. Try again when you're ready.
              </div>
            </div>
            <button onClick={() => setPaymentBanner(null)} style={{ background: "none", border: "none",
              cursor: "pointer", color: "#9ca3af", fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
        );
        return paymentBanner.type === "success" ? (
          <div style={{
            background: "#FDF5EC", border: "1.5px solid #D4A87A",
            borderRadius: "12px", margin: "16px 16px 0",
            padding: "14px 18px", display: "flex", alignItems: "flex-start",
            justifyContent: "space-between", gap: "12px",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
              <span style={{ fontSize: "20px", marginTop: "1px" }}>✅</span>
              <div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#C4541A", fontWeight: 600, marginBottom: "4px" }}>
                  Payment successful!{amount ? ` ${amount} paid.` : " Your invoice has been marked as paid."}
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#6b7280", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ fontSize: "11px", background: "#635bff", color: "#fff",
                      borderRadius: "4px", padding: "1px 5px", fontWeight: 700, letterSpacing: "0.5px" }}>
                      STRIPE
                    </span>
                    {cardLine}
                  </span>
                  {paidDate && <span>· {paidDate}</span>}
                  {paymentBanner.invoiceId && <span style={{ color: "#9ca3af" }}>· {paymentBanner.invoiceId}</span>}
                </div>
              </div>
            </div>
            <button onClick={() => setPaymentBanner(null)} style={{ background: "none", border: "none",
              cursor: "pointer", color: "#9ca3af", fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
        ) : (
          <div style={{
            background: "#fef2f2", border: "1.5px solid #fecaca",
            borderRadius: "12px", margin: "16px 16px 0",
            padding: "14px 18px", display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: "12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>❌</span>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#dc2626", fontWeight: 600 }}>
                Payment cancelled — you can try again from your invoices page.
              </div>
            </div>
            <button onClick={() => setPaymentBanner(null)} style={{ background: "none", border: "none",
              cursor: "pointer", color: "#9ca3af", fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
        );
      })()}
      {/* PRICING PAGE */}
      {/* ── OVERVIEW PAGE ── */}
      {page === "overview" && (() => {
        const now = new Date();
        const upcomingWalks = myBookings
          .filter(b => !b.cancelled && b.scheduledDateTime && new Date(b.scheduledDateTime) > now)
          .sort((a, b) => new Date(a.scheduledDateTime) - new Date(b.scheduledDateTime));
        const nextWalk = upcomingWalks[0];

        const punchCount = client.punchCardCount || 0;
        const pendingClaims = (client.freeWalkClaims || []).filter(c => !c.fulfilled);
        const canClaim = punchCount >= PUNCH_CARD_GOAL;

        const openInvoices = (client.invoices || []).filter(inv => {
          const { effectiveStatus } = invoiceStatusMeta(inv.status, inv.dueDate);
          return effectiveStatus === "sent" || effectiveStatus === "overdue";
        });
        const overdueInvoices = openInvoices.filter(inv => invoiceStatusMeta(inv.status, inv.dueDate).effectiveStatus === "overdue");
        const outstandingTotal = openInvoices.reduce((s, inv) => s + (inv.total || 0), 0);

        const renderKpiCard = ({ label, value, sub, onClick, accent, alert }) => (
          <div onClick={onClick} style={{
            background: "#fff", borderRadius: "16px", padding: "16px 18px",
            border: alert ? "1.5px solid #fca5a5" : "1.5px solid #f0ede8",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            cursor: onClick ? "pointer" : "default",
            display: "flex", flexDirection: "column", gap: "4px",
            transition: "box-shadow 0.15s",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "1px", color: "#9ca3af" }}>{label}</div>
              {onClick && <span style={{ fontSize: "12px", color: "#d1d5db" }}>→</span>}
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700,
              color: accent || "#111827", lineHeight: 1.1 }}>{value}</div>
            {sub && <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
              color: alert ? "#ef4444" : "#9ca3af" }}>{sub}</div>}
          </div>
        );

        return (
          <div className="app-container fade-up" style={{ padding: "24px 16px 80px", maxWidth: "600px", margin: "0 auto" }}>
            {/* Greeting */}
            <div style={{ fontFamily: "'DM Sans', sans-serif", marginBottom: "24px" }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: "#111827" }}>
                Hey, {(client.name || client.email).split(" ")[0]} 👋
              </div>
              <div style={{ fontSize: "15px", color: "#6b7280", marginTop: "2px" }}>
                Here's a snapshot of your account.
              </div>
            </div>

            {/* ── Unpaid first walk banner ── */}
            {(() => {
              const unpaidFirstWalk = (client.bookings || []).find(
                b => b.isFirstWalk && b.status === "pending_payment" && !b.cancelled && !b.paidAt
              );
              if (!unpaidFirstWalk) return null;
              return (
                <div style={{
                  background: "linear-gradient(135deg, #fef2f2, #fff)",
                  border: "1.5px solid #fca5a5",
                  borderRadius: "16px",
                  padding: "18px 20px",
                  marginBottom: "20px",
                  display: "flex", alignItems: "flex-start", gap: "14px",
                }}>
                  <span style={{ fontSize: "24px", flexShrink: 0, marginTop: "2px" }}>💳</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                      fontSize: "16px", color: "#111827", marginBottom: "4px" }}>
                      Payment needed for your first walk
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                      color: "#6b7280", lineHeight: "1.6", marginBottom: "12px" }}>
                      Your {unpaidFirstWalk.slot?.duration} walk on {unpaidFirstWalk.day}, {unpaidFirstWalk.date} at {unpaidFirstWalk.slot?.time} is reserved but unpaid.
                    </div>
                    <button onClick={() => handlePayFirstWalk(unpaidFirstWalk)}
                      disabled={!!payingBookingKey}
                      style={{ padding: "10px 20px", borderRadius: "10px", border: "none",
                        background: "#C4541A", color: "#fff",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                        fontWeight: 700, cursor: payingBookingKey ? "wait" : "pointer",
                        opacity: payingBookingKey ? 0.7 : 1 }}>
                      {payingBookingKey === unpaidFirstWalk.key ? "Redirecting…" : `Pay $${unpaidFirstWalk.price} now →`}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* KPI grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>

              {renderKpiCard({
                label: "Upcoming Walks",
                value: upcomingWalks.length,
                sub: nextWalk
                  ? `Next: ${new Date(nextWalk.scheduledDateTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
                  : "None scheduled",
                onClick: () => setPage("mywalks"),
              })}

              {renderKpiCard({
                label: "Open Invoices",
                value: openInvoices.length === 0 ? "✓ Paid up" : openInvoices.length,
                sub: openInvoices.length > 0
                  ? overdueInvoices.length > 0
                    ? `$${outstandingTotal} due · ${overdueInvoices.length} overdue`
                    : `$${outstandingTotal} outstanding`
                  : "Nothing owed",
                accent: openInvoices.length > 0 ? (overdueInvoices.length > 0 ? "#ef4444" : "#b45309") : "#059669",
                alert: overdueInvoices.length > 0,
                onClick: () => setPage("invoices"),
              })}

              {renderKpiCard({
                label: "Lonestar Loyalty",
                value: `${punchCount} / ${PUNCH_CARD_GOAL}`,
                sub: canClaim ? "🏆 Free 60-min walk ready!" : `${PUNCH_CARD_GOAL - punchCount} more to free walk`,
                accent: canClaim ? "#059669" : "#C4541A",
                onClick: () => setPage("pricing"),
              })}

              {renderKpiCard({
                label: "Your Walker",
                value: client.preferredWalker || "None set",
                sub: client.preferredWalker ? "Your go-to walker" : "Set during booking",
                accent: "#111827",
              })}
            </div>

            {/* Punch card — full width */}
            {(() => {
              return (
                <div style={{
                  background: canClaim ? "linear-gradient(135deg,#3D8B5F,#0B1423)" : "#fff",
                  borderRadius: "16px", padding: "20px",
                  border: canClaim ? "none" : "1.5px solid #f0ede8",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600,
                        textTransform: "uppercase", letterSpacing: "1px",
                        color: canClaim ? "#C4A07A" : "#9ca3af" }}>Lonestar Loyalty</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "28px", fontWeight: 700,
                        color: canClaim ? "#fff" : "#111827", marginTop: "4px" }}>
                        {punchCount} / {PUNCH_CARD_GOAL}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                        color: canClaim ? "rgba(255,255,255,0.75)" : "#6b7280", marginTop: "2px" }}>
                        {canClaim ? "You've earned a free 60-min walk!"
                          : punchCount === 0 ? "Every paid walk counts — 10 walks = 1 free 60-min walk"
                          : `${PUNCH_CARD_GOAL - punchCount} more walk${PUNCH_CARD_GOAL - punchCount !== 1 ? "s" : ""} until your free 60-min walk`}
                      </div>
                    </div>
                    <span style={{ fontSize: "32px" }}>{canClaim ? "🏆" : "⭐"}</span>
                  </div>

                  {/* Paw print punch grid */}
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "14px" }}>
                    {Array.from({ length: PUNCH_CARD_GOAL }).map((_, i) => {
                      const earned = i < punchCount;
                      return (
                        <div key={i} style={{
                          width: "30px", height: "30px",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: earned ? "22px" : "20px",
                          transition: "all 0.25s",
                          filter: earned ? "none" : "grayscale(1) opacity(0.18)",
                          transform: earned ? "scale(1.08)" : "scale(1)",
                        }}>
                          🐾
                        </div>
                      );
                    })}
                  </div>

                  {/* Claim button */}
                  {canClaim && (
                    <button onClick={() => {
                      if (!window.confirm("Claim your free 60-min walk? This will use 10 walks.")) return;
                      const updated = claimPunchCardWalk(client);
                      if (!updated) return;
                      const updatedClients = { ...clients, [clientPinKey]: updated };
                      setClients(updatedClients);
                      saveClients(updatedClients);
                      notifyAdmin("free_walk_claimed", { clientName: client.name || client.email, walkType: "60 min", punchesUsed: PUNCH_CARD_GOAL });
                    }} style={{
                      padding: "10px 18px", borderRadius: "10px", border: "1.5px solid rgba(255,255,255,0.4)",
                      background: "rgba(255,255,255,0.15)", color: "#fff",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer",
                    }}>
                      Claim Free 60-min Walk 🎉
                    </button>
                  )}

                  {/* Pending unfulfilled claims */}
                  {pendingClaims.length > 0 && (
                    <div style={{ marginTop: "12px", padding: "10px 14px", borderRadius: "10px",
                      background: "rgba(255,255,255,0.12)", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "13px", color: canClaim ? "rgba(255,255,255,0.85)" : "#6b7280" }}>
                      ⏳ {pendingClaims.length} free walk claim{pendingClaims.length > 1 ? "s" : ""} pending — we'll reach out to schedule it.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Quick action */}
            <button onClick={() => setPage("book")} style={{
              marginTop: "20px", width: "100%", padding: "16px",
              background: "#0B1423", border: "none", borderRadius: "14px",
              color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            }}>
              🐾 Book a Walk
            </button>
          </div>
        );
      })()}

      {page === "pricing" && (
        <div className="app-container fade-up">
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
            letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "14px" }}>
            Pricing
          </div>
          <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
            {[["30 min", 30], ["60 min", 45]].map(([dur, price]) => (
              <div key={dur} style={{ flex: 1, background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "16px", padding: "20px 22px", textAlign: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", textTransform: "uppercase",
                  letterSpacing: "1.5px", color: "#9ca3af", marginBottom: "8px" }}>{dur}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "28px",
                  fontWeight: 700, color: "#C4541A" }}>${price}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>per session</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
            letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "14px" }}>
            Add-ons & Discounts
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
            {ADD_ONS.map((addon, i) => (
              <div key={i} style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "12px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "#FDF5EC",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>
                  {addon.icon}
                </div>
                <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: "16px",
                    color: "#111827", marginBottom: "2px" }}>{addon.label}</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>{addon.note}</div>
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                  fontWeight: 600, color: "#C4541A", flexShrink: 0 }}>{addon.price}</div>
              </div>
            ))}
          </div>

          {/* Additional Fees */}
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
            letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "14px" }}>
            Additional Fees
          </div>
          <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px",
            overflow: "hidden", marginBottom: "28px" }}>
            {[
              {
                icon: "🎉", color: "#b45309", bg: "#fffbeb", border: "#fcd34d",
                label: "Holidays",
                fee: "+$25/day",
                note: "Applied to all bookings on major holidays. Advance payment required for holiday reservations.",
                asterisk: true,
              },
              {
                icon: "🌙", color: "#3D6B7A", bg: "#EBF4F6", border: "#8EBCC6",
                label: "After 7:00 PM",
                fee: "+$10",
                note: "Additional fee applied to any walk starting after 7:00 PM.",
              },
              {
                icon: "⚡", color: "#C4541A", bg: "#FDF5EC", border: "#D4A843",
                label: "Same-Day Express",
                fee: "+$10",
                note: "Same-day booking service fee applied to all express reservations.",
              },
            ].map((row, i, arr) => (
              <div key={i} style={{ padding: "16px 18px",
                borderBottom: i < arr.length - 1 ? "1px solid #f3f4f6" : "none",
                display: "flex", gap: "14px", alignItems: "flex-start" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: row.bg,
                  border: `1.5px solid ${row.border}`, display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>
                  {row.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    gap: "8px", marginBottom: "4px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                      fontSize: "15px", color: "#111827" }}>
                      {row.label}{row.asterisk && <span style={{ color: "#b45309" }}>*</span>}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      fontWeight: 600, color: row.color, whiteSpace: "nowrap", flexShrink: 0 }}>{row.fee}</div>
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#6b7280", lineHeight: "1.5" }}>{row.note}</div>
                </div>
              </div>
            ))}
            <div style={{ padding: "12px 18px", background: "#f9fafb", borderTop: "1px solid #f3f4f6" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af", lineHeight: "1.5" }}>
                <span style={{ color: "#b45309" }}>*</span> Holiday bookings require advance payment. Please review the cancellation policy below.
              </div>
            </div>
          </div>

          {/* Punch card summary on pricing page */}
          {(() => {
            const pc = client.punchCardCount || 0;
            const pcCanClaim = pc >= PUNCH_CARD_GOAL;
            return (
              <div style={{ background: pcCanClaim ? "#0B1423" : "#fff",
                border: pcCanClaim ? "none" : "2px solid #8B5E3C",
                borderRadius: "16px", padding: "20px", marginBottom: "28px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                      fontWeight: 600, color: pcCanClaim ? "#fff" : "#111827", marginBottom: "2px" }}>
                      ⭐ Lonestar Loyalty
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "28px", fontWeight: 700,
                      color: pcCanClaim ? "#fff" : "#111827" }}>
                      {pc} / {PUNCH_CARD_GOAL}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                      color: pcCanClaim ? "rgba(255,255,255,0.75)" : "#6b7280", marginTop: "2px" }}>
                      {pcCanClaim ? "Go to your Overview to claim your free 60-min walk!"
                        : pc > 0
                          ? `${PUNCH_CARD_GOAL - pc} more walk${PUNCH_CARD_GOAL - pc !== 1 ? "s" : ""} until your free 60-min walk`
                          : "Every paid walk counts — 10 walks = 1 free 60-min walk"}
                    </div>
                  </div>
                  <span style={{ fontSize: "32px" }}>{pcCanClaim ? "🏆" : "⭐"}</span>
                </div>
                {!pcCanClaim && (
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                    {Array.from({ length: PUNCH_CARD_GOAL }).map((_, i) => {
                      const earned = i < pc;
                      return (
                        <div key={i} style={{
                          width: "28px", height: "28px",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: earned ? "20px" : "18px",
                          transition: "all 0.25s",
                          filter: earned ? "none" : "grayscale(1) opacity(0.18)",
                          transform: earned ? "scale(1.08)" : "scale(1)",
                        }}>
                          🐾
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
            letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "14px" }}>
            Cancellation Policy
          </div>
          <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px",
            overflow: "hidden", marginBottom: "28px" }}>
            {[
              {
                icon: "✅", color: "#C4541A", bg: "#FDF5EC", border: "#D4A843",
                window: "More than 24 hours before",
                fee: "No charge",
                desc: "Cancel any time more than 24 hours before your appointment and you won't be charged a thing.",
              },
              {
                icon: "⚠️", color: "#b45309", bg: "#fffbeb", border: "#fcd34d",
                window: "12–24 hours before",
                fee: "50% of session price",
                desc: "Cancellations within 12 to 24 hours of the appointment will be charged half the session fee.",
              },
              {
                icon: "🚫", color: "#dc2626", bg: "#fef2f2", border: "#fecaca",
                window: "12 hours or less before",
                fee: "100% of session price",
                desc: "Cancellations within 12 hours — including no-shows — will be charged the full session price.",
              },
            ].map((row, i, arr) => (
              <div key={i} style={{
                padding: "16px 18px",
                borderBottom: i < arr.length - 1 ? "1px solid #f3f4f6" : "none",
                display: "flex", gap: "14px", alignItems: "flex-start",
              }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: row.bg,
                  border: `1.5px solid ${row.border}`, display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>
                  {row.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    gap: "8px", marginBottom: "4px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                      fontSize: "15px", color: "#111827" }}>{row.window}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      fontWeight: 600, color: row.color, whiteSpace: "nowrap", flexShrink: 0 }}>{row.fee}</div>
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#6b7280", lineHeight: "1.5" }}>{row.desc}</div>
                </div>
              </div>
            ))}
            <div style={{ padding: "12px 18px", background: "#f9fafb",
              borderTop: "1px solid #f3f4f6" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af", lineHeight: "1.5" }}>
                Cancellation fees are charged to the payment method on file. Prices shown reflect your current weekly booking tier and are applied at the time of cancellation.
              </div>
            </div>
          </div>

          <button onClick={() => setPage("book")} style={{ width: "100%", padding: "16px",
            borderRadius: "12px", border: "none", background: "#0B1423", color: "#fff",
            fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 500, cursor: "pointer" }}>
            Book a Session →
          </button>
        </div>
      )}

      {/* MY WALKS PAGE */}
      {page === "mywalks" && (() => {
        const now = new Date();
        const { monday, sunday } = getCurrentWeekRange();
        const walksQ = walksSearch.toLowerCase();
        const allActive = myBookings.filter(b => {
          if (b.cancelled) return false;
          if (!walksQ) return true;
          return (
            (b.form?.pet || "").toLowerCase().includes(walksQ) ||
            (b.form?.walker || "").toLowerCase().includes(walksQ) ||
            (b.day || "").toLowerCase().includes(walksQ) ||
            (b.date || "").toLowerCase().includes(walksQ) ||
            (b.slot?.time || "").toLowerCase().includes(walksQ) ||
            (b.slot?.duration || "").toLowerCase().includes(walksQ)
          );
        });
        const pastWalks = allActive.filter(b => b.scheduledDateTime && new Date(b.scheduledDateTime) <= now);
        const futureWalks = allActive.filter(b => b.scheduledDateTime && new Date(b.scheduledDateTime) > now);

        // Synthesize pending meet & greet as an upcoming item
        const handoffInfo = client.handoffInfo;
        const handoffAppt = (!client.handoffConfirmed && handoffInfo?.handoffDate && handoffInfo?.handoffSlot)
          ? {
              key: "__handoff__",
              isHandoff: true,
              service: "handoff",
              day: new Date(handoffInfo.handoffDate).toLocaleDateString("en-US", { weekday: "long" }),
              date: new Date(handoffInfo.handoffDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
              slot: { time: handoffInfo.handoffSlot.time, duration: "15 min" },
              form: { walker: handoffInfo.handoffWalker || "", pet: "", name: client.name || "" },
              scheduledDateTime: handoffInfo.handoffDate,
              price: null,
            }
          : null;

        // Generate recurring instances for next 4 weeks
        const recurringSchedules = client.recurringSchedules || [];
        const recurringInstances = [];
        recurringSchedules.forEach(rec => {
          for (let w = 0; w < 4; w++) {
            const { monday: wMon } = getWeekRangeForOffset(w);
            const wMonKey = wMon.toISOString().slice(0, 10);
            // Skip if this week is cancelled for this series
            if (rec.cancelledWeeks && rec.cancelledWeeks.includes(wMonKey)) continue;
            // Build the scheduled date for this week
            const apptDate = new Date(wMon);
            apptDate.setDate(wMon.getDate() + rec.dayOfWeek);
            const [timePart, meridiem] = rec.slotTime.split(" ");
            let [hours, minutes] = timePart.split(":").map(Number);
            if (meridiem === "PM" && hours !== 12) hours += 12;
            if (meridiem === "AM" && hours === 12) hours = 0;
            apptDate.setHours(hours, minutes || 0, 0, 0);
            if (apptDate <= now) continue;
            // Skip if there's already a real booking for this slot this week
            const alreadyBooked = futureWalks.some(b =>
              b.recurringId === rec.id &&
              Math.abs(new Date(b.scheduledDateTime) - apptDate) < 60000
            );
            if (alreadyBooked) continue;
            recurringInstances.push({
              isRecurringInstance: true,
              recurringId: rec.id,
              recurringWeekKey: wMonKey,
              service: rec.service,
              day: FULL_DAYS[rec.dayOfWeek],
              slot: { time: rec.slotTime, duration: rec.duration, id: rec.slotId },
              form: rec.form,
              scheduledDateTime: apptDate.toISOString(),
              price: getSessionPrice(rec.duration, 1),
              additionalDogCount: rec.additionalDogCount || 0,
            });
          }
        });

        // Merge real future bookings + recurring instances (handoffAppt rendered separately at top)
        const allFuture = [...futureWalks, ...recurringInstances]
          .sort((a, b) => new Date(a.scheduledDateTime) - new Date(b.scheduledDateTime));

        // Group all future by week
        const weekGroups = {};
        allFuture.forEach(b => {
          const d = new Date(b.scheduledDateTime);
          const dow = d.getDay();
          const off = dow === 0 ? -6 : 1 - dow;
          const mon = new Date(d);
          mon.setDate(d.getDate() + off);
          const key = mon.toISOString().slice(0, 10);
          if (!weekGroups[key]) weekGroups[key] = { monday: mon, bookings: [] };
          weekGroups[key].bookings.push(b);
        });

        const completedCount = pastWalks.length;
        const walksInCycle = completedCount % 11;
        const readyForFree = walksInCycle >= 10;

        const handleCancelSeries = (recurringId) => {
          const updated = {
            ...client,
            recurringSchedules: (client.recurringSchedules || []).filter(r => r.id !== recurringId),
          };
          const updatedClients = { ...clients, [clientPinKey]: updated };
          setClients(updatedClients);
          saveClients(updatedClients);
        };

        const handleCancelRecurringWeek = (recurringId, weekKey) => {
          const updated = {
            ...client,
            recurringSchedules: (client.recurringSchedules || []).map(r =>
              r.id === recurringId
                ? { ...r, cancelledWeeks: [...(r.cancelledWeeks || []), weekKey] }
                : r
            ),
          };
          const updatedClients = { ...clients, [clientPinKey]: updated };
          setClients(updatedClients);
          saveClients(updatedClients);
        };

        return (
          <div className="app-container fade-up">

            {/* ── Welcome banner ── */}
            <div style={{ borderRadius: "16px", overflow: "hidden", marginBottom: "16px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.08)", position: "relative",
              background: "linear-gradient(135deg, #4d2e10 0%, #8B5E3C 100%)", height: "80px" }}>
              <div style={{ position: "absolute", inset: 0,
                background: "linear-gradient(to right, rgba(77,46,16,0.55) 0%, transparent 60%)",
                display: "flex", alignItems: "center", padding: "0 20px" }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                    fontSize: "17px", fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "1.5px", marginBottom: "4px" }}>Your Walks</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "rgba(255,255,255,0.85)",
                    fontSize: "14px" }}>They're waiting for you 🐾</div>
                </div>
              </div>
            </div>

            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: "20px" }}>
              <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)",
                fontSize: "16px", pointerEvents: "none" }}>🔍</span>
              <input
                value={walksSearch}
                onChange={e => setWalksSearch(e.target.value)}
                placeholder="Search by pet, walker, day, time…"
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px",
                  borderRadius: "10px", border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", color: "#111827", background: "#fff", outline: "none" }}
              />
              {walksSearch && (
                <button onClick={() => setWalksSearch("")} style={{ position: "absolute", right: "10px",
                  top: "50%", transform: "translateY(-50%)", background: "none", border: "none",
                  cursor: "pointer", color: "#9ca3af", fontSize: "16px" }}>✕</button>
              )}
            </div>

            {/* ── Cancellation Confirmation Modal ── */}
            {recurringCancelConfirm && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
                zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
                padding: "24px" }}>
                <div style={{ background: "#fff", borderRadius: "18px", padding: "28px 24px",
                  maxWidth: "380px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
                  <div style={{ fontSize: "32px", textAlign: "center", marginBottom: "14px" }}>
                    {recurringCancelConfirm.type === "series" ? "⚠️" : "📅"}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "#111827", textAlign: "center", marginBottom: "10px" }}>
                    {recurringCancelConfirm.type === "series" ? "Cancel Recurring Walk?" : "Skip This Week's Walk?"}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#6b7280", textAlign: "center", lineHeight: "1.65", marginBottom: "24px" }}>
                    {recurringCancelConfirm.type === "series"
                      ? <>You are about to permanently cancel your recurring walk scheduled for <strong style={{ color: "#111827" }}>{recurringCancelConfirm.label}</strong>. All future occurrences will be removed and this action cannot be undone. To resume service, you will need to schedule a new recurring booking.</>
                      : <>You are about to skip your walk on <strong style={{ color: "#111827" }}>{recurringCancelConfirm.label}</strong>. Your recurring schedule will remain active — only this week's session will be removed.</>
                    }
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <button onClick={() => {
                      if (recurringCancelConfirm.type === "series") handleCancelSeries(recurringCancelConfirm.recurringId);
                      else handleCancelRecurringWeek(recurringCancelConfirm.recurringId, recurringCancelConfirm.weekKey);
                      setRecurringCancelConfirm(null);
                    }} style={{
                      width: "100%", padding: "13px", borderRadius: "11px", border: "none",
                      background: recurringCancelConfirm.type === "series" ? "#dc2626" : "#b45309",
                      color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      fontWeight: 600, cursor: "pointer",
                    }}>
                      {recurringCancelConfirm.type === "series" ? "Yes, Cancel Recurring Walk" : "Yes, Skip This Week"}
                    </button>
                    <button onClick={() => setRecurringCancelConfirm(null)} style={{
                      width: "100%", padding: "13px", borderRadius: "11px",
                      border: "1.5px solid #e4e7ec", background: "#fff",
                      color: "#374151", fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      fontWeight: 500, cursor: "pointer",
                    }}>
                      Keep My Booking
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Punch card mini banner */}
            {(() => {
              const pc = client.punchCardCount || 0;
              const pcCanClaim = pc >= PUNCH_CARD_GOAL;
              return (
                <div style={{ background: pcCanClaim ? "#0B1423" : "#FDF5EC",
                  border: pcCanClaim ? "none" : "1.5px solid #D4A87A",
                  borderRadius: "16px", padding: "18px 20px", marginBottom: "28px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "10px" }}>
                    <div style={{ fontSize: "32px" }}>{pcCanClaim ? "🏆" : "⭐"}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                        fontSize: "20px", color: pcCanClaim ? "#fff" : "#111827" }}>
                        {pc} / {PUNCH_CARD_GOAL} walks
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                        color: pcCanClaim ? "rgba(255,255,255,0.75)" : "#6b7280", marginTop: "2px" }}>
                        {pcCanClaim ? "Tap below to claim your free 60-min walk"
                          : `${PUNCH_CARD_GOAL - pc} more walk${PUNCH_CARD_GOAL - pc !== 1 ? "s" : ""} for a free 60-min walk`}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                        color: pcCanClaim ? "#C4A07A" : "#C4541A" }}>{completedCount}</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                        color: pcCanClaim ? "rgba(255,255,255,0.6)" : "#6b7280" }}>total walks</div>
                    </div>
                  </div>
                  {!pcCanClaim && (
                    <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginTop: "2px" }}>
                      {Array.from({ length: PUNCH_CARD_GOAL }).map((_, i) => {
                        const earned = i < pc;
                        return (
                          <div key={i} style={{
                            width: "26px", height: "26px",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: earned ? "19px" : "17px",
                            transition: "all 0.25s",
                            filter: earned ? "none" : "grayscale(1) opacity(0.18)",
                            transform: earned ? "scale(1.08)" : "scale(1)",
                          }}>
                            🐾
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {pcCanClaim && (
                    <button onClick={() => setPage("overview")}
                      style={{ marginTop: "8px", padding: "10px 18px", borderRadius: "10px",
                        border: "1.5px solid rgba(255,255,255,0.35)",
                        background: "rgba(255,255,255,0.15)", color: "#fff",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
                      Claim free 60-min walk →
                    </button>
                  )}
                </div>
              );
            })()}

            {/* ── MEET & GREET (pinned, always at top) ── */}
            {handoffAppt && (
              <div style={{ marginBottom: "28px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600,
                  letterSpacing: "2px", textTransform: "uppercase", color: "#7A4D6E",
                  marginBottom: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
                  <span>Meet &amp; Greet</span>
                  <div style={{ flex: 1, height: "1px", background: "#E8D5E4" }} />
                </div>
                <div style={{ background: "#F5EFF3", borderRadius: "14px", padding: "16px 18px",
                  border: "1.5px solid #C4A0B8", boxShadow: "0 2px 10px rgba(122,77,110,0.08)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
                    <div style={{ width: "44px", height: "44px", borderRadius: "12px",
                      background: "#EAD9E6", display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: "22px", flexShrink: 0 }}>🤝</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        fontWeight: 700, color: "#7A4D6E", marginBottom: "3px" }}>Meet &amp; Greet Appointment</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9B7A94" }}>
                        {handoffAppt.day}, {fmtBookingDate(handoffAppt.scheduledDateTime)} · {handoffAppt.slot?.time} · 15 min
                      </div>
                      {handoffAppt.form?.walker && (
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9B7A94", marginTop: "1px" }}>
                          with {handoffAppt.form.walker}
                        </div>
                      )}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#9B7A94", fontStyle: "italic", flexShrink: 0 }}>Free</div>
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                    color: "#9B7A94", lineHeight: "1.5", marginBottom: "14px",
                    padding: "10px 12px", background: "rgba(255,255,255,0.6)", borderRadius: "8px" }}>
                    This appointment is required before booking any walks. We'll use it to meet your pup and go over everything together.
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={() => setHandoffEditOpen(true)}
                      style={{ flex: 1, padding: "10px", borderRadius: "10px", cursor: "pointer",
                        border: "1.5px solid #C4A0B8", background: "#fff",
                        color: "#7A4D6E", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", fontWeight: 600 }}>
                      ✏️ Reschedule
                    </button>
                    <button onClick={() => setHandoffCancelConfirm(true)}
                      style={{ flex: 1, padding: "10px", borderRadius: "10px", cursor: "pointer",
                        border: "1.5px solid #fecaca", background: "#fef2f2",
                        color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", fontWeight: 600 }}>
                      ✕ Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── UPCOMING ── */}
            {(Object.keys(weekGroups).length > 0 || recurringSchedules.length > 0) && (
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600,
                letterSpacing: "2px", textTransform: "uppercase", color: "#C4541A",
                marginBottom: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
                <span>Upcoming</span>
                <div style={{ flex: 1, height: "1px", background: "#f3f4f6" }} />
              </div>
            )}

            {/* Weekly totals for upcoming bookings */}
            {Object.keys(weekGroups).length > 0 && (
              <div style={{ marginBottom: "28px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {Object.entries(weekGroups).sort(([a],[b]) => a.localeCompare(b)).map(([key, group]) => {
                    const weekTotal = group.bookings.filter(b => !b.isHandoff).reduce((sum, b) => sum + effectivePrice(b), 0);
                    const weekCount = group.bookings.filter(b => !b.isHandoff).length;
                    const weekEnd = new Date(group.monday);
                    weekEnd.setDate(group.monday.getDate() + 6);
                    const isCurrentWeek = group.monday >= monday && group.monday <= sunday;
                    return (
                      <div key={key} style={{ background: "#fff", border: isCurrentWeek ? "2px solid #8B5E3C" : "1.5px solid #e4e7ec",
                        borderRadius: "16px", overflow: "hidden" }}>
                        <div style={{ padding: "14px 18px", background: isCurrentWeek ? "#FDF5EC" : "#fafafa",
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          borderBottom: "1px solid #f3f4f6" }}>
                          <div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                              fontSize: "15px", color: "#111827" }}>
                              {isCurrentWeek ? "This week" : `Week of ${group.monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
                              {weekCount} walk{weekCount !== 1 ? "s" : ""}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                              fontWeight: 600, color: "#111827" }}>${weekTotal}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                              est. total
                            </div>
                          </div>
                        </div>
                        <div style={{ padding: "10px 18px", display: "flex", flexDirection: "column", gap: "8px" }}>
                          {group.bookings.sort((a, b) => new Date(a.scheduledDateTime) - new Date(b.scheduledDateTime)).map((b, i) => {
                            const s = SERVICES[b.service] || SERVICES["dog"];
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "4px 0" }}>
                                <span style={{ fontSize: "16px" }}>{s.icon}</span>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                      fontWeight: 500, color: "#111827" }}>{b.form?.pet || "—"}</div>
                                    {b.isRecurringInstance && (
                                      <span style={{ fontSize: "16px", background: "#FDF5EC",
                                        color: "#C4541A", border: "1px solid #D4A87A",
                                        borderRadius: "4px", padding: "1px 5px",
                                        fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>🔁 recurring</span>
                                    )}
                                    {b.isFirstWalk && b.status !== "pending_payment" && (
                                      <span style={{ fontSize: "16px", background: "#EBF4F6",
                                        color: "#3D6B7A", border: "1px solid #8EBCC6",
                                        borderRadius: "4px", padding: "1px 5px",
                                        fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>⭐ first walk</span>
                                    )}
                                    {b.isFirstWalk && b.status === "pending_payment" && !b.paidAt && (
                                      <span style={{ fontSize: "16px", background: "#fef2f2",
                                        color: "#dc2626", border: "1px solid #fca5a5",
                                        borderRadius: "4px", padding: "1px 5px",
                                        fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>💳 unpaid</span>
                                    )}
                                    {b.isRecurringPending && b.status === "pending_payment" && !b.paidAt && (
                                      <span style={{ fontSize: "16px", background: "#fef2f2",
                                        color: "#dc2626", border: "1px solid #fca5a5",
                                        borderRadius: "4px", padding: "1px 5px",
                                        fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>💳 unpaid</span>
                                    )}
                                  </div>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
                                    {b.day} {fmtBookingDate(b.scheduledDateTime)} at {b.slot?.time} · {b.slot?.duration}
                                    {b.sameDayDiscount && (
                                      <span style={{ marginLeft: "6px", fontSize: "16px", background: "#fffbeb",
                                        color: "#b45309", border: "1px solid #fcd34d",
                                        borderRadius: "4px", padding: "1px 5px",
                                        fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>20% off same day</span>
                                    )}
                                  </div>
                                  {b.isRecurringInstance && (() => {
                                    const daysUntil = (new Date(b.scheduledDateTime) - Date.now()) / (1000 * 60 * 60 * 24);
                                    const showPay = daysUntil <= 7;
                                    return (
                                      <>
                                        {showPay && (
                                          <button onClick={() => handlePayRecurringInstance(b)}
                                            style={{ display: "inline-flex", alignItems: "center", gap: "6px",
                                              marginTop: "6px", padding: "7px 14px", borderRadius: "8px",
                                              border: "none", background: "#C4541A", color: "#fff",
                                              fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                                              fontWeight: 700, cursor: "pointer" }}>
                                            💳 Pay ${b.price} to confirm →
                                          </button>
                                        )}
                                        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                                          <button onClick={() => setRecurringCancelConfirm({ type: "week", recurringId: b.recurringId, weekKey: b.recurringWeekKey, label: `${b.day} at ${b.slot?.time}` })}
                                            style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                              color: "#b45309", background: "none", border: "none",
                                              padding: 0, cursor: "pointer", textDecoration: "underline" }}>
                                            Skip this week
                                          </button>
                                          <span style={{ color: "#d1d5db", fontSize: "16px" }}>·</span>
                                          <button onClick={() => setRecurringCancelConfirm({ type: "series", recurringId: b.recurringId, label: `${FULL_DAYS[b.dayOfWeek] || b.day} at ${b.slot?.time}` })}
                                            style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                              color: "#dc2626", background: "none", border: "none",
                                              padding: 0, cursor: "pointer", textDecoration: "underline" }}>
                                            Cancel series
                                          </button>
                                        </div>
                                      </>
                                    );
                                  })()}
                                  {b.isFirstWalk && b.status === "pending_payment" && !b.paidAt && (
                                    <button onClick={() => handlePayFirstWalk(b)}
                                      style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                                        fontWeight: 700, color: "#fff", background: "#C4541A",
                                        border: "none", borderRadius: "8px",
                                        padding: "6px 14px", cursor: "pointer", marginTop: "6px" }}>
                                      💳 Pay ${b.price} to confirm →
                                    </button>
                                  )}
                                  {b.isRecurringPending && b.status === "pending_payment" && !b.paidAt && (
                                    <button onClick={() => handlePayFirstWalk(b)}
                                      style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                                        fontWeight: 700, color: "#fff", background: "#C4541A",
                                        border: "none", borderRadius: "8px",
                                        padding: "6px 14px", cursor: "pointer", marginTop: "6px" }}>
                                      💳 Pay ${b.price} to confirm →
                                    </button>
                                  )}
                                  {!b.isRecurringInstance && (
                                    <button onClick={() => setSelectedBooking(b)}
                                      style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                        color: "#6b7280", background: "none", border: "none",
                                        padding: 0, cursor: "pointer", textDecoration: "underline", marginTop: "2px" }}>
                                      View details
                                    </button>
                                  )}
                                </div>
                                <div style={{ textAlign: "right", flexShrink: 0 }}>
                                  {b.sameDayDiscount && b.priceBeforeSameDayDiscount && (
                                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                      color: "#d1d5db", textDecoration: "line-through" }}>
                                      ${b.priceBeforeSameDayDiscount}
                                    </div>
                                  )}
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                    fontWeight: 600, color: b.sameDayDiscount ? "#b45309" : "#C4541A" }}>
                                    ${effectivePrice(b)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Active recurring schedules */}
            {recurringSchedules.length > 0 && (
              <div style={{ marginBottom: "28px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                  letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "14px" }}>
                  Weekly Recurring
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {recurringSchedules.map(rec => {
                    const s = SERVICES[rec.service] || SERVICES["dog"];
                    return (
                      <div key={rec.id} style={{ background: "#fff", border: "2px solid #D4A87A",
                        borderRadius: "14px", padding: "14px 16px", display: "flex",
                        alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "40px", height: "40px", borderRadius: "10px",
                          background: s.light, display: "flex", alignItems: "center",
                          justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>{s.icon}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                              fontSize: "15px", color: "#111827" }}>
                              {rec.form?.pet || s.label}
                            </div>
                            <span style={{ fontSize: "16px", background: "#FDF5EC", color: "#C4541A",
                              border: "1px solid #D4A87A", borderRadius: "4px", padding: "1px 5px",
                              fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>🔁 weekly</span>
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
                            Every {FULL_DAYS[rec.dayOfWeek]} at {rec.slotTime} · {rec.duration}
                          </div>
                        </div>
                        <button onClick={() => setRecurringCancelConfirm({ type: "series", recurringId: rec.id, label: `Every ${FULL_DAYS[rec.dayOfWeek]} at ${rec.slotTime}` })} style={{
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#dc2626",
                          background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "7px",
                          padding: "5px 10px", cursor: "pointer", flexShrink: 0, fontWeight: 500,
                        }}>Cancel</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── OLD WALKS (grouped by week, collapsible) ── */}
            {pastWalks.length > 0 && (() => {
              // Group past walks into Mon–Sun weeks, newest first
              const sorted = [...pastWalks].sort((a, b) =>
                new Date(b.scheduledDateTime) - new Date(a.scheduledDateTime)
              );
              const weekMap = new Map();
              sorted.forEach(b => {
                const d = new Date(b.scheduledDateTime);
                // Find the Monday of this walk's week
                const day = d.getDay(); // 0=Sun
                const monday = new Date(d);
                monday.setDate(d.getDate() - ((day + 6) % 7));
                monday.setHours(0, 0, 0, 0);
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6);
                const key = monday.toISOString().slice(0, 10);
                const fmt = (dt) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                const label = `${fmt(monday)} – ${fmt(sunday)}`;
                if (!weekMap.has(key)) weekMap.set(key, { key, label, walks: [] });
                weekMap.get(key).walks.push(b);
              });
              const weeks = [...weekMap.values()];

              return (
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600,
                    letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af",
                    marginBottom: "10px", display: "flex", alignItems: "center", gap: "10px" }}>
                    <span>Old Walks</span>
                    <div style={{ flex: 1, height: "1px", background: "#f3f4f6" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {weeks.map(({ key, label, walks }) => {
                      const open = expandedWeeks.has(key);
                      const weekTotal = walks.reduce((s, b) => s + (Number(b.price) || 0), 0);
                      return (
                        <div key={key} style={{ border: "1.5px solid #e4e7ec", borderRadius: "12px",
                          overflow: "hidden", background: "#fff" }}>
                          {/* Week header row — always visible, click to expand */}
                          <button onClick={() => toggleWeek(key)} style={{
                            width: "100%", display: "flex", alignItems: "center", gap: "10px",
                            padding: "10px 14px", background: "none", border: "none",
                            cursor: "pointer", textAlign: "left",
                          }}>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                              fontWeight: 600, color: "#374151", flex: 1 }}>{label}</span>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                              color: "#9ca3af" }}>
                              {walks.length} walk{walks.length !== 1 ? "s" : ""}
                              {weekTotal > 0 ? ` · $${weekTotal.toFixed(0)}` : ""}
                            </span>
                            <span style={{ fontSize: "11px", color: "#9ca3af",
                              transform: open ? "rotate(180deg)" : "none",
                              transition: "transform 0.18s", display: "inline-block" }}>▼</span>
                          </button>

                          {/* Expanded walk rows */}
                          {open && (
                            <div style={{ borderTop: "1px solid #f3f4f6" }}>
                              {walks.map((b, i) => {
                                const s = SERVICES[b.service] || SERVICES["dog"];
                                const d = new Date(b.scheduledDateTime);
                                const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                                return (
                                  <div key={i} onClick={() => setSelectedBooking(b)}
                                    style={{ display: "flex", alignItems: "center", gap: "10px",
                                      padding: "8px 14px", cursor: "pointer",
                                      borderBottom: i < walks.length - 1 ? "1px solid #f9fafb" : "none",
                                      transition: "background 0.12s" }}
                                    onMouseEnter={e => e.currentTarget.style.background = "#fafafa"}
                                    onMouseLeave={e => e.currentTarget.style.background = "none"}>
                                    <div style={{ width: "28px", height: "28px", borderRadius: "8px",
                                      background: s.light, display: "flex", alignItems: "center",
                                      justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>
                                      {s.icon}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                                        fontWeight: 500, color: "#374151", whiteSpace: "nowrap",
                                        overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {b.form?.pet}{b.form?.walker ? ` · ${b.form.walker}` : ""}
                                      </div>
                                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                                        color: "#9ca3af" }}>
                                        {dateLabel} · {b.slot?.time} · {b.slot?.duration}
                                      </div>
                                    </div>
                                    {b.price > 0 && (
                                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                                        fontWeight: 600, color: "#9ca3af", flexShrink: 0 }}>
                                        ${Number(b.price).toFixed(0)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {futureWalks.length === 0 && pastWalks.length === 0 && recurringSchedules.length === 0 && (
              <div style={{ textAlign: "center", padding: "48px 0" }}>
                <div style={{ fontSize: "40px", marginBottom: "12px" }}>🐕</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#9ca3af", fontSize: "16px" }}>
                  No walks yet — book your first session!
                </div>
              </div>
            )}

          </div>
        );
      })()}

      {/* ── BOOKING DETAIL SHEET (global — works from any page) ── */}
      {selectedBooking && (() => {
        const b = selectedBooking;
        const s = SERVICES[b.service] || SERVICES["dog"];
        const policy = b.scheduledDateTime ? getCancellationPolicy(b.scheduledDateTime) : null;
        const penaltyAmount = policy ? Math.round((b.price || 0) * policy.penalty) : 0;
        return (
          <div className="fade-up" style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}>
            <div className="bottom-sheet">

              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: "24px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                  fontWeight: 600, color: "#111827" }}>Booking Details</div>
                <button onClick={() => { setSelectedBooking(null); setRecurringCancelConfirm(null); setCancelConfirm(null); }}
                  style={{ background: "#f3f4f6", border: "none", borderRadius: "50%",
                    width: "32px", height: "32px", cursor: "pointer", fontSize: "16px",
                    display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>✕</button>
              </div>

              {/* Service badge */}
              <div style={{ background: s.light, border: `1.5px solid ${s.border}`,
                borderRadius: "14px", padding: "16px 18px", marginBottom: "20px",
                display: "flex", alignItems: "center", gap: "14px" }}>
                <span style={{ fontSize: "28px" }}>{s.icon}</span>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                    fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", color: "#111827" }}>{s.label}</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: s.color }}>
                    {b.day} {fmtBookingDate(b.scheduledDateTime)} at {b.slot?.time} · {b.slot?.duration}
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0",
                border: "1.5px solid #e4e7ec", borderRadius: "14px",
                overflow: "hidden", marginBottom: "20px" }}>
                {[
                  b.form?.pet    && ["Pet",     b.form.pet],
                  b.form?.name   && ["Owner",   b.form.name],
                  b.form?.email  && ["Email",   b.form.email],
                  b.form?.phone  && ["Phone",   b.form.phone],
                  b.form?.address && ["Address", b.form.address],
                  b.form?.walker && ["Walker",  firstName(b.form.walker)],
                  b.form?.notes  && ["Notes",   b.form.notes],
                  b.price > 0 && ["Session Price", b.sameDayDiscount
                    ? `${fmt(b.price, true)} (20% off — M&G discount)`
                    : `${fmt(b.price, true)}`],
                ].filter(Boolean).map(([label, val], i, arr) => (
                  <div key={label} style={{ padding: "12px 16px",
                    borderBottom: i < arr.length - 1 ? "1px solid #f3f4f6" : "none",
                    display: "flex", justifyContent: "space-between", gap: "12px",
                    background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#9ca3af", flexShrink: 0 }}>{label}</span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#374151", textAlign: "right" }}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Cancellation policy */}
              {policy && (
                <div style={{ padding: "12px 16px", borderRadius: "12px", marginBottom: "16px",
                  background: policy.penalty === 0 ? "#FDF5EC" : policy.penalty === 0.5 ? "#fffbeb" : "#fef2f2",
                  border: `1.5px solid ${policy.penalty === 0 ? "#D4A843" : policy.penalty === 0.5 ? "#fcd34d" : "#fecaca"}` }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                    fontSize: "15px", color: policy.color, marginBottom: "3px" }}>
                    {policy.label}{penaltyAmount > 0 ? ` — $${penaltyAmount} charge` : ""}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                    {policy.penalty === 0
                      ? "You can cancel this appointment for free — more than 24 hours out."
                      : policy.penalty === 0.5
                      ? "You're within 12–24 hours of your appointment. A 50% fee applies if cancelled."
                      : "You're within 12 hours of your appointment. The full session fee applies if cancelled."}
                  </div>
                </div>
              )}

              {/* Cancel button */}
              {policy?.canCancel && !cancelConfirm && (
                <button onClick={() => setCancelConfirm(b.key)}
                  style={{ width: "100%", padding: "14px", borderRadius: "12px",
                    border: "1.5px solid #fecaca", background: "#fff",
                    color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "16px", fontWeight: 500, cursor: "pointer" }}>
                  Cancel This Appointment
                </button>
              )}

              {/* Cancel confirmation */}
              {cancelConfirm === b.key && (
                <div className="fade-up" style={{ padding: "16px", background: "#fef2f2",
                  borderRadius: "12px", border: "1.5px solid #fecaca" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                    fontSize: "16px", color: "#dc2626", marginBottom: "6px" }}>
                    {policy.penalty === 0
                      ? "Cancel for free?"
                      : `Cancel with a $${penaltyAmount} ${policy.penalty === 1 ? "100%" : "50%"} fee?`}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#6b7280", marginBottom: "16px" }}>
                    {policy.penalty === 0
                      ? "No charge — cancellation is free more than 24 hours in advance."
                      : policy.penalty === 0.5
                      ? "You're within 12–24 hours of your appointment. A 50% fee applies."
                      : "You're within 12 hours of your appointment. The full session fee applies."}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button disabled={cancelling} onClick={() => { handleCancel(b.key); setSelectedBooking(null); setRecurringCancelConfirm(null); setCancelConfirm(null); }}
                      style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none",
                        background: cancelling ? "#f87171" : "#dc2626", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", fontWeight: 500, cursor: cancelling ? "not-allowed" : "pointer" }}>
                      {cancelling ? "Cancelling…" : "Yes, cancel"}
                    </button>
                    <button onClick={() => setCancelConfirm(null)}
                      style={{ flex: 1, padding: "12px", borderRadius: "10px",
                        border: "1px solid #d1d5db", background: "#fff",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        cursor: "pointer", color: "#374151" }}>
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {page === "invoices" && (
        <ClientInvoicesPage client={client} clients={clients} setClients={setClients} />
      )}

      {page === "myinfo" && (
        <ClientMyInfoPage client={client} clients={clients} setClients={setClients} />
      )}

      {/* ── MESSAGES PAGE ── */}
      {page === "messages" && (
        <div className="fade-up" style={{ padding: "20px 16px", maxWidth: "680px", margin: "0 auto" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
            fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Message Your Walker</div>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
            marginBottom: "12px" }}>
            Send a message directly to {firstName(client.keyholder)} — your key holder and primary walker.
          </p>

          {/* Search bar */}
          <div style={{ position: "relative", marginBottom: "12px" }}>
            <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)",
              fontSize: "16px", pointerEvents: "none" }}>🔍</span>
            <input
              value={messagesSearch}
              onChange={e => setMessagesSearch(e.target.value)}
              placeholder="Search messages…"
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px",
                borderRadius: "10px", border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", color: "#111827", background: "#fff", outline: "none" }}
            />
            {messagesSearch && (
              <button onClick={() => setMessagesSearch("")} style={{ position: "absolute", right: "10px",
                top: "50%", transform: "translateY(-50%)", background: "none", border: "none",
                cursor: "pointer", color: "#9ca3af", fontSize: "16px" }}>✕</button>
            )}
          </div>

          {/* Notice banner */}
          <div style={{ background: "#fffbeb", border: "1.5px solid #fbbf24", borderRadius: "12px",
            padding: "12px 16px", marginBottom: "16px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "1px" }}>🕐</span>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#92400e", lineHeight: "1.6" }}>
              <strong>Heads up:</strong> Your walker is out and about caring for pets and may not see messages right away. For anything urgent, please contact{" "}
              <strong>Lonestar Bark Co. admin</strong> directly — we're always available to help.
            </div>
          </div>

          <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
            borderRadius: "16px", overflow: "hidden" }}>
            <div ref={clientMsgContainerRef} style={{ padding: "16px 18px", height: "420px",
              overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
              {clientMsgLoading && clientMsgs.length === 0 ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                  Loading messages…
                </div>
              ) : clientMsgs.length === 0 ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <span style={{ fontSize: "32px" }}>💬</span>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af",
                    textAlign: "center" }}>
                    No messages yet. Say hello to {firstName(client.keyholder)}!
                  </div>
                </div>
              ) : (
                <>
                  {clientMsgs.filter(msg => !messagesSearch || msg.text.toLowerCase().includes(messagesSearch.toLowerCase())).map(msg => {
                    const isMine = msg.from === client.name;
                    return (
                      <div key={msg.id} style={{ display: "flex", flexDirection: "column",
                        alignItems: isMine ? "flex-end" : "flex-start" }}>
                        {!isMine && (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af", marginBottom: "4px", fontWeight: 600 }}>{msg.from}</div>
                        )}
                        <div style={{ padding: "10px 14px",
                          borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                          background: isMine ? "#C4541A" : "#f3f4f6",
                          color: isMine ? "#fff" : "#111827",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          maxWidth: "80%", lineHeight: "1.5" }}>
                          {msg.text}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#d1d5db", marginTop: "3px" }}>{msg.time}</div>
                      </div>
                    );
                  })}
                  <div ref={clientMsgBottomRef} />
                </>
              )}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #f3f4f6",
              display: "flex", gap: "8px" }}>
              <input value={clientMsgInput} onChange={e => setClientMsgInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendClientMsg()}
                placeholder={`Message ${firstName(client.keyholder)}…`}
                style={{ flex: 1, padding: "10px 14px", borderRadius: "10px",
                  border: "1.5px solid #e4e7ec", background: "#fff",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#111827", outline: "none" }} />
              <button onClick={sendClientMsg} style={{
                padding: "10px 18px", borderRadius: "10px", border: "none",
                background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>Send</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CONTACT US PAGE ── */}
      {page === "contact" && (
          <div className="app-container fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "6px" }}>Contact Us</div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280",
              marginBottom: "24px", lineHeight: "1.6" }}>
              Have a question, special request, or feedback? We'd love to hear from you.
            </p>

            {contactSent ? (
              <div style={{ background: "#FDF5EC", border: "1.5px solid #D4A843", borderRadius: "14px",
                padding: "24px", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "12px" }}>✅</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "17px", fontWeight: 600,
                  color: "#C4541A", marginBottom: "8px" }}>Message Sent!</div>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
                  lineHeight: "1.6", marginBottom: "16px" }}>
                  Thanks for reaching out. We'll get back to you as soon as possible.
                </p>
                <button onClick={() => { setContactForm({ subject: "", message: "", contactPref: "email" }); setContactSent(false); }} style={{
                  padding: "10px 24px", borderRadius: "10px", border: "1.5px solid #D4A843",
                  background: "transparent", color: "#C4541A", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", fontWeight: 600, cursor: "pointer",
                }}>Send Another Message</button>
              </div>
            ) : (
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px",
                padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* From info (auto-filled) */}
                <div style={{ background: "#f9fafb", borderRadius: "10px", padding: "14px 16px",
                  display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700,
                    letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af" }}>From</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#111827", fontWeight: 500 }}>
                    {client.name || "—"}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                    {client.email || "—"} {client.phone ? `· ${client.phone}` : ""}
                  </div>
                </div>

                {/* Contact Preference */}
                <div>
                  <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                    fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
                    color: "#9ca3af", marginBottom: "8px" }}>How should we reach you?</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {[
                      { val: "email", icon: "📧", label: "Email" },
                      { val: "text",  icon: "💬", label: "Text" },
                      { val: "cell",  icon: "📞", label: "Call" },
                    ].map(opt => (
                      <button key={opt.val}
                        onClick={() => setContactForm(f => ({ ...f, contactPref: opt.val }))}
                        style={{
                          flex: 1, padding: "10px 8px", borderRadius: "10px",
                          border: contactForm.contactPref === opt.val
                            ? "2px solid #C4541A" : "1.5px solid #e4e7ec",
                          background: contactForm.contactPref === opt.val
                            ? "#FDF5EC" : "#fff",
                          cursor: "pointer", textAlign: "center",
                        }}>
                        <div style={{ fontSize: "18px", marginBottom: "2px" }}>{opt.icon}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                          fontWeight: contactForm.contactPref === opt.val ? 700 : 400,
                          color: contactForm.contactPref === opt.val ? "#C4541A" : "#6b7280",
                        }}>{opt.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subject */}
                <div>
                  <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                    fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
                    color: "#9ca3af", marginBottom: "5px" }}>Subject</label>
                  <input type="text" placeholder="e.g. Schedule question, special request..."
                    value={contactForm.subject}
                    onChange={e => setContactForm(f => ({ ...f, subject: e.target.value }))}
                    style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", boxSizing: "border-box",
                      border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#111827", outline: "none", background: "#fff" }} />
                </div>

                {/* Message */}
                <div>
                  <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                    fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
                    color: "#9ca3af", marginBottom: "5px" }}>Message</label>
                  <textarea rows={5} placeholder="How can we help?"
                    value={contactForm.message}
                    onChange={e => setContactForm(f => ({ ...f, message: e.target.value }))}
                    style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", boxSizing: "border-box",
                      border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#111827", outline: "none", background: "#fff", resize: "vertical" }} />
                </div>

                {/* Submit */}
                <button onClick={async () => {
                    if (!contactForm.message.trim()) return;
                    setContactSending(true);
                    await saveContactSubmission({
                      name: client.name || "",
                      email: client.email || "",
                      phone: client.phone || "",
                      subject: contactForm.subject,
                      message: contactForm.message,
                      contactPref: contactForm.contactPref,
                      source: "client",
                    });
                    setContactSending(false);
                    setContactSent(true);
                  }}
                  disabled={!contactForm.message.trim() || contactSending}
                  style={{
                    padding: "13px 28px", borderRadius: "10px", border: "none",
                    background: contactForm.message.trim() && !contactSending ? "#C4541A" : "#e4e7ec",
                    color: contactForm.message.trim() && !contactSending ? "#fff" : "#9ca3af",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                    cursor: contactForm.message.trim() && !contactSending ? "pointer" : "default",
                    alignSelf: "flex-end", transition: "all 0.2s ease",
                  }}>{contactSending ? "Sending..." : "Send Message →"}</button>
              </div>
            )}
          </div>
      )}

      {/* ── BOOK PAGE ── */}
      {page === "book" && (() => {
        // Block booking only if no M&G is scheduled at all.
        // If M&G is scheduled but not yet confirmed, allow booking — the date picker
        // already enforces that walks can only be selected on/after the M&G date.
        const needsMeetAndGreet = !client.handoffConfirmed && !client.handoffInfo?.handoffDate;

        if (needsMeetAndGreet) {
          const hasPending = !!(client.handoffInfo?.handoffDate && client.handoffInfo?.handoffSlot);
          const pendingDateLabel = hasPending
            ? new Date(client.handoffInfo.handoffDate).toLocaleDateString("en-US",
                { weekday: "long", month: "long", day: "numeric" })
            : null;
          const pendingTimeLabel = hasPending ? client.handoffInfo.handoffSlot?.time : null;
          const purple = "#7A4D6E";
          return (
            <>
              {/* Single "Meet & Greet" tab bar (locked) */}
              <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec",
                display: "flex", width: "100%" }}>
                <div style={{ flex: 1, padding: "14px 8px", textAlign: "center",
                  borderBottom: `3px solid ${purple}`,
                  background: "#F7F0F5",
                  color: purple,
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600 }}>
                  🤝 Meet & Greet
                </div>
              </div>

              <div className="app-container">
                {/* Info banner */}
                <div style={{ background: "#FDF5EC", border: "1.5px solid #D4A87A",
                  borderRadius: "12px", padding: "14px 18px", marginBottom: "20px",
                  display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <span style={{ fontSize: "20px", flexShrink: 0 }}>🔒</span>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#92400e", lineHeight: "1.5" }}>
                    <strong>Meet & Greet required</strong> — a quick 15-minute intro with your walker unlocks
                    all booking services. Once your appointment is complete, you're all set!
                  </div>
                </div>

                {hasPending ? (
                  /* ── Pending appointment card ── */
                  <div style={{ background: "#F5EFF3", border: `1.5px solid #C4A0B8`,
                    borderRadius: "16px", padding: "20px", marginBottom: "20px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                      textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700,
                      color: purple, marginBottom: "12px" }}>Your Scheduled Appointment</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px",
                      marginBottom: "16px" }}>
                      <span style={{ fontSize: "32px" }}>🤝</span>
                      <div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          fontWeight: 700, color: "#111827" }}>{pendingDateLabel}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#6b7280" }}>{pendingTimeLabel} · 15 min</div>
                        {client.handoffInfo?.handoffWalker && (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                            color: "#9ca3af", marginTop: "2px" }}>
                            with {client.handoffInfo.handoffWalker}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button onClick={() => setHandoffEditOpen(true)}
                        style={{ flex: 1, padding: "11px", borderRadius: "10px",
                          border: `1.5px solid ${purple}`, background: "#fff",
                          color: purple, fontFamily: "'DM Sans', sans-serif",
                          fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
                        Reschedule
                      </button>
                      <button onClick={() => setHandoffCancelConfirm(true)}
                        style={{ flex: 1, padding: "11px", borderRadius: "10px",
                          border: "1.5px solid #fca5a5", background: "#fff",
                          color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── No appointment — prompt to schedule ── */
                  <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                    borderRadius: "16px", padding: "28px 20px", textAlign: "center",
                    marginBottom: "20px" }}>
                    <div style={{ fontSize: "48px", marginBottom: "12px" }}>🤝</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "17px",
                      fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
                      Schedule Your Meet & Greet
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#6b7280", lineHeight: "1.6", marginBottom: "20px" }}>
                      A free 15-minute appointment to get acquainted with your walker
                      before your first walk.
                    </div>
                    <button onClick={() => setHandoffEditOpen(true)}
                      style={{ padding: "14px 32px", borderRadius: "12px", border: "none",
                        background: purple, color: "#fff",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 600, cursor: "pointer" }}>
                      Pick a Time →
                    </button>
                  </div>
                )}
              </div>
            </>
          );
        }

        return (
        <>
          <style>{`
            .svc-tab { display: flex; align-items: center; justify-content: center; gap: 8px; }
            .svc-tab .svc-icon { font-size: 18px; }
            @media (max-width: 480px) {
              .svc-tab .svc-icon { display: none; }
              .svc-tab { font-size: 14px !important; padding: 12px 4px !important; }
            }
          `}</style>

          {/* ── Meet & Greet pending notice ── */}
          {!client.handoffConfirmed && client.handoffInfo?.handoffDate && (() => {
            const mgLabel = new Date(client.handoffInfo.handoffDate).toLocaleDateString("en-US",
              { weekday: "long", month: "long", day: "numeric" });
            return (
              <div style={{ background: "#F5EFF3", borderBottom: "1px solid #C4A0B8",
                padding: "10px 18px", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "18px", flexShrink: 0 }}>🤝</span>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                  color: "#7A4D6E", lineHeight: "1.4" }}>
                  <strong>Meet & Greet on {mgLabel}</strong> — walks available from that date onward.
                </div>
              </div>
            );
          })()}

          <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec",
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", width: "100%" }}>
            {Object.values(SERVICES).map(s => {
              const active = service === s.id;
              return (
                <button key={s.id} className="slot-btn svc-tab"
                  onClick={() => {
                    const pets = s.id === "dog" ? savedDogs : savedCats;
                    setService(s.id);
                    setSelectedSlot(null);
                    setSelectedWalks([{ slotId: "", duration: "30 min" }]);
                    setForm(f => ({ ...f, pet: pets.slice(-1)[0] || "" }));
                    if (step === "form") setStep("pick");
                  }}
                  style={{ padding: "14px 8px", border: "none",
                    borderBottom: active ? `3px solid ${s.color}` : "3px solid transparent",
                    borderRight: "1px solid #f0f0f0",
                    background: active ? `${s.color}08` : "transparent",
                    color: active ? s.color : "#6b7280",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: active ? 600 : 400, cursor: "pointer" }}>
                  <span className="svc-icon">{s.icon}</span>{s.label}
                </button>
              );
            })}
            {/* Overnight tab */}
            <button className="slot-btn svc-tab"
              onClick={() => { setService("overnight"); if (step === "form") setStep("pick"); }}
              style={{ padding: "14px 8px", border: "none",
                borderBottom: service === "overnight" ? "3px solid #7A4D6E" : "3px solid transparent",
                background: service === "overnight" ? "#7A4D6E08" : "transparent",
                color: service === "overnight" ? "#7A4D6E" : "#6b7280",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                fontWeight: service === "overnight" ? 600 : 400, cursor: "pointer" }}>
              <span className="svc-icon">🌙</span>Overnight
            </button>
          </div>

          <div className="app-container">

            {/* ── OVERNIGHT BOOKING ── */}
            {service === "overnight" && (() => {
              const purple = "#7A4D6E";
              const purpleLight = "#F5EFF3";
              const purpleBorder = "#C4A0B8";

              // Min date: 3 days from today
              const minDate = (() => {
                const d = new Date();
                d.setDate(d.getDate() + 3);
                return d.toISOString().slice(0, 10);
              })();
              // Max date: 16 weeks from today
              const maxDate = (() => {
                const d = new Date();
                d.setDate(d.getDate() + 16 * 7);
                return d.toISOString().slice(0, 10);
              })();

              const price = overnightLocation === "ours" ? 100 : 150;

              const handleOvernightSubmit = () => {
                setOvernightSubmitting(true);
                setTimeout(() => {
                  const apptDate = new Date(overnightDate + "T19:00:00");
                  const newBooking = {
                    key: `overnight-${overnightDate}-${Date.now()}`,
                    service: "overnight",
                    day: apptDate.toLocaleDateString("en-US", { weekday: "long" }),
                    date: apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                    slot: {
                      id: `overnight-${overnightDate}`,
                      time: "7:00 PM",
                      duration: "Overnight (7pm–7am)",
                    },
                    form: { ...form, notes: overnightNotes, walker: overnightWalker },
                    bookedAt: new Date().toISOString(),
                    scheduledDateTime: apptDate.toISOString(),
                    price,
                    overnightLocation,
                    overnightDate,
                    isOvernight: true,
                    additionalDogCount: 0,
                    additionalDogCharge: 0,
                  };
                  const allBookings = [...myBookings, newBooking];
                  const updated = { ...client, bookings: allBookings,
                    address: form.address || client.address || "",
                    phone: form.phone || client.phone || "",
                  };
                  setClients({ ...clients, [clientPinKey]: updated });
                  saveClients({ ...clients, [clientPinKey]: updated });
                  setOvernightSubmitting(false);
                  setOvernightStep("confirm");
                }, 800);
              };

              if (overnightStep === "confirm") {
                const d = new Date(overnightDate + "T12:00:00");
                const displayDate = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
                return (
                  <div className="fade-up" style={{ textAlign: "center", padding: "32px 0" }}>
                    <div className="pop" style={{ fontSize: "52px", marginBottom: "16px" }}>✓</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                      fontWeight: 600, color: "#111827", marginBottom: "8px" }}>Overnight Requested</div>
                    <p style={{ fontFamily: "'DM Sans', sans-serif", color: "#6b7280",
                      fontSize: "16px", marginBottom: "28px", lineHeight: "1.6" }}>
                      We'll confirm availability and reach out to <strong style={{ color: "#374151" }}>{form.email}</strong> within 24 hours.
                    </p>
                    <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                      borderRadius: "14px", padding: "20px", textAlign: "left", marginBottom: "24px" }}>
                      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
                        <div style={{ width: "44px", height: "44px", borderRadius: "10px",
                          background: purpleLight, display: "flex", alignItems: "center",
                          justifyContent: "center", fontSize: "22px" }}>🌙</div>
                        <div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                            fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", color: "#111827" }}>Overnight Stay</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: purple }}>
                            {displayDate} · 7:00 PM – 7:00 AM
                          </div>
                        </div>
                      </div>
                      {[
                        ["Location", overnightLocation === "ours" ? "At our place" : "At your place"],
                        ["Rate", `${fmt(price, true)} / stay`],
                        overnightWalker && ["Walker", firstName(overnightWalker)],
                        overnightNotes && ["Notes", overnightNotes],
                      ].filter(Boolean).map(([label, val]) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between",
                          marginBottom: "8px", borderTop: "1px solid #f3f4f6", paddingTop: "8px" }}>
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>{label}</span>
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#374151", textAlign: "right", maxWidth: "60%" }}>{val}</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => { setOvernightStep("pick"); setOvernightDate(""); setOvernightNotes(""); setOvernightLocation("ours"); setOvernightWalker(""); }}
                      style={{ width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                        background: purple, color: "#fff", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "16px", fontWeight: 500, cursor: "pointer" }}>
                      Book Another Night
                    </button>
                  </div>
                );
              }

              return (
                <div className="fade-up">
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "#111827", marginBottom: "6px" }}>Overnight Stay</div>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#6b7280", marginBottom: "24px", lineHeight: "1.6" }}>
                    We stay so you don't have to worry. Every overnight runs 7:00 PM to 7:00 AM — 
                    your pet is fed, settled, and in good hands from lights-out to morning.
                  </p>

                  {/* Pricing cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "24px" }}>
                    {[
                      { id: "ours", icon: "🏡", title: "At our place", price: "$100", sub: "per stay",
                        bullets: ["Walker's home environment", "Great for social pets", "Drop off by 7 PM"] },
                      { id: "yours", icon: "🔑", title: "At your place", price: "$150", sub: "per stay",
                        bullets: ["Your pet stays home", "Ideal for anxious animals", "We arrive by 7 PM"] },
                    ].map(opt => (
                      <button key={opt.id} onClick={() => setOvernightLocation(opt.id)}
                        style={{ padding: "16px 14px", borderRadius: "14px", cursor: "pointer", textAlign: "left",
                          border: overnightLocation === opt.id ? `2px solid ${purple}` : "1.5px solid #e4e7ec",
                          background: overnightLocation === opt.id ? purpleLight : "#fff",
                          boxShadow: overnightLocation === opt.id ? `0 2px 12px ${purple}22` : "none",
                          transition: "all 0.15s" }}>
                        <div style={{ fontSize: "24px", marginBottom: "8px" }}>{opt.icon}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                          fontWeight: 600, color: "#111827", marginBottom: "2px" }}>{opt.title}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: purple, fontWeight: 700, marginBottom: "10px" }}>
                          {opt.price} <span style={{ fontWeight: 400, color: "#9ca3af" }}>{opt.sub}</span>
                        </div>
                        {opt.bullets.map(b => (
                          <div key={b} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#6b7280", marginBottom: "3px", display: "flex", alignItems: "flex-start", gap: "5px" }}>
                            <span style={{ color: purple, flexShrink: 0 }}>·</span>{b}
                          </div>
                        ))}
                      </button>
                    ))}
                  </div>

                  {/* Terms banner */}
                  <div style={{ background: purpleLight, border: `1.5px solid ${purpleBorder}`,
                    borderRadius: "12px", padding: "14px 16px", marginBottom: "24px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                      fontSize: "16px", color: purple, marginBottom: "6px" }}>📋 Overnight Terms</div>
                    <ul style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#6b7280", lineHeight: "1.7", margin: 0, paddingLeft: "16px" }}>
                      <li>All stays are 7:00 PM – 7:00 AM (12 hours)</li>
                      <li>Must be booked at least 3 days in advance</li>
                      <li>Subject to walker availability — we'll confirm within 24 hours</li>
                      <li>Cancellations within 48 hours of stay are non-refundable</li>
                      <li>Your pet must be current on vaccinations</li>
                    </ul>
                  </div>

                  {/* Date picker */}
                  <div style={{ marginBottom: "20px" }}>
                    <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", fontWeight: 600, letterSpacing: "2px",
                      textTransform: "uppercase", color: "#9ca3af", marginBottom: "8px" }}>
                      Night of Stay
                    </label>
                    <input type="date" value={overnightDate}
                      min={minDate} max={maxDate}
                      onChange={e => setOvernightDate(e.target.value)}
                      style={{ width: "100%", padding: "12px 14px", borderRadius: "10px",
                        border: "1.5px solid #d1d5db", background: "#fff",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: overnightDate ? "#111827" : "#9ca3af", outline: "none" }}
                      onFocus={e => e.target.style.borderColor = purple}
                      onBlur={e => e.target.style.borderColor = "#d1d5db"} />
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#9ca3af", marginTop: "5px" }}>
                      Bookable 3 days to 16 weeks out · Walker arrives / you drop off by 7:00 PM
                    </div>
                  </div>

                  {/* Notes */}
                  <div style={{ marginBottom: "28px" }}>
                    <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", fontWeight: 600, letterSpacing: "2px",
                      textTransform: "uppercase", color: "#9ca3af", marginBottom: "8px" }}>
                      Notes for your walker <span style={{ fontWeight: 400, textTransform: "none",
                        letterSpacing: 0, color: "#d1d5db" }}>(optional)</span>
                    </label>
                    <textarea value={overnightNotes} onChange={e => setOvernightNotes(e.target.value)}
                      rows={4} placeholder="Feeding schedule, medications, bedtime routine, any quirks we should know…"
                      style={{ width: "100%", padding: "12px 14px", borderRadius: "10px",
                        border: "1.5px solid #d1d5db", background: "#fff",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        color: "#111827", resize: "vertical", lineHeight: "1.6", outline: "none" }}
                      onFocus={e => e.target.style.borderColor = purple}
                      onBlur={e => e.target.style.borderColor = "#d1d5db"} />
                  </div>

                  {/* Walker preference */}
                  <div style={{ marginBottom: "20px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                      letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>
                      Preferred Walker / Stayer <span style={{ fontWeight: 400, textTransform: "none",
                        letterSpacing: 0, color: "#d1d5db" }}>(optional)</span>
                    </div>
                    <div style={{ display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "4px" }}>
                      <button onClick={() => setOvernightWalker("")}
                        style={{
                          position: "relative", flexShrink: 0, padding: "12px 16px", borderRadius: "14px",
                          border: overnightWalker === "" ? `2px solid ${purple}` : "1.5px solid #e4e7ec",
                          background: overnightWalker === "" ? `${purple}10` : "#fff",
                          cursor: "pointer", textAlign: "left", minWidth: "130px",
                          boxShadow: overnightWalker === "" ? `0 2px 12px ${purple}22` : "none",
                          transition: "all 0.15s",
                        }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                          <span style={{ fontSize: "20px" }}>✦</span>
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "15px", color: "#111827", marginBottom: "2px" }}>No preference</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                          Any available
                        </div>
                      </button>
                      {getAllWalkers(walkerProfiles).filter(w =>
                        Object.values(walkerAvailability[w.id] || {}).some(slots => slots.length > 0)
                      ).map(w => {
                        const isPreferred = w.name === client.preferredWalker;
                        const isSelected = overnightWalker === w.name;
                        return (
                          <button key={w.id} onClick={() => setOvernightWalker(w.name)}
                            ref={isPreferred ? overnightWalkerRef : null}
                            style={{
                              position: "relative", flexShrink: 0, padding: "12px 16px", borderRadius: "14px",
                              border: isSelected ? `2px solid ${w.color}` : "1.5px solid #e4e7ec",
                              background: isSelected ? `${w.color}10` : "#fff",
                              cursor: "pointer", textAlign: "left", minWidth: "130px",
                              boxShadow: isSelected ? `0 2px 12px ${w.color}22` : "none",
                              transition: "all 0.15s",
                            }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                              <span style={{ fontSize: "20px" }}>{w.avatar}</span>
                              {isPreferred && (
                                <span style={{ fontSize: "11px", background: w.color, color: "#fff",
                                  borderRadius: "4px", padding: "1px 5px", fontFamily: "'DM Sans', sans-serif",
                                  fontWeight: 700, letterSpacing: "0.5px" }}>YOUR WALKER</span>
                              )}
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                              fontSize: "15px", color: "#111827", marginBottom: "2px" }}>{firstName(w.name)}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                              Subject to availability
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                      color: "#9ca3af", marginTop: "6px", lineHeight: "1.5" }}>
                      Preferred walkers are subject to availability and may not always be guaranteed.
                    </div>
                  </div>

                  {/* Price summary */}
                  {overnightDate && (
                    <div className="fade-up" style={{ background: purpleLight,
                      border: `1.5px solid ${purpleBorder}`, borderRadius: "12px",
                      padding: "14px 18px", marginBottom: "20px",
                      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: purple, fontWeight: 600 }}>
                          {new Date(overnightDate + "T12:00:00").toLocaleDateString("en-US",
                            { weekday: "long", month: "long", day: "numeric" })}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                          {overnightLocation === "ours" ? "At our place" : "At your place"} · 7 PM – 7 AM
                        </div>
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                        fontWeight: 600, color: purple }}>${price}</div>
                    </div>
                  )}

                  <button
                    disabled={!overnightDate || overnightSubmitting}
                    onClick={handleOvernightSubmit}
                    style={{ width: "100%", padding: "16px", borderRadius: "12px", border: "none",
                      background: overnightDate ? purple : "#e4e7ec",
                      color: overnightDate ? "#fff" : "#9ca3af",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      fontWeight: 500, cursor: overnightDate ? "pointer" : "default",
                      transition: "all 0.15s" }}>
                    {overnightSubmitting ? "Submitting…" : "Request Overnight Stay →"}
                  </button>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#9ca3af", textAlign: "center", marginTop: "10px", lineHeight: "1.5" }}>
                    This is a booking request. We'll confirm availability within 24 hours.
                  </div>
                </div>
              );
            })()}

            {/* PICK STEP */}
            {step === "pick" && service !== "overnight" && (
              <div className="fade-up">

                {showHandoffBanner && (
                  <div style={{ background: "#FDF5EC", border: "1.5px solid #D4A87A",
                    borderRadius: "12px", padding: "12px 16px", marginBottom: "20px",
                    display: "flex", alignItems: "center", gap: "10px",
                    animation: "fadeUp 0.3s ease forwards" }}>
                    <span style={{ fontSize: "18px" }}>🤝</span>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#C4541A", flex: 1 }}>
                      <strong>Meet & Greet complete</strong> — you're all set to book any service!
                    </div>
                    <button onClick={() => setShowHandoffBanner(false)} style={{
                      background: "none", border: "none", color: "#D4A843", cursor: "pointer",
                      fontSize: "16px", lineHeight: 1, padding: "2px 4px", flexShrink: 0,
                    }}>✕</button>
                  </div>
                )}

                <QuickRebookBanner
                  client={client}
                  service={service}
                  myBookings={myBookings}
                  clients={clients}
                  setClients={setClients}
                  onBooked={() => {}}
                />

                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af",
                    marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>🕐</span>
                  <span>We require <strong style={{ color: "#6b7280" }}>24 hours notice</strong> — only dates more than 24 hours from now are available.</span>
                </div>


                {/* Walker selector */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                    letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>
                    Your Walker
                  </div>
                  <div style={{ display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "4px" }}>
                    {(() => {
                      const all = getAllWalkers(walkerProfiles).filter(w =>
                        Object.values(walkerAvailability[w.id] || {}).some(slots => slots.length > 0)
                      );
                      const preferred = client.preferredWalker;
                      return [
                        ...all.filter(w => w.name === preferred),
                        ...all.filter(w => w.name !== preferred),
                      ];
                    })().map(w => {
                      const isPreferred = w.name === (client.preferredWalker || getAllWalkers(walkerProfiles)[0]?.name);
                      const isSelected = form.walker === w.name;
                      const walkerDateSlots = walkerAvailability[w.id]?.[selectedDateKey] || [];
                      const hasAvail = walkerDateSlots.length > 0;
                      const hasAnyAvail = Object.values(walkerAvailability[w.id] || {}).some(slots => slots.length > 0);
                      const dotColor = hasAvail ? "#22c55e" : hasAnyAvail ? "#f59e0b" : "#ef4444";
                      const dotTitle = hasAvail ? "Available this day" : hasAnyAvail ? "Available other days" : "No availability set";
                      return (
                        <button key={w.id} onClick={() => setForm(f => ({ ...f, walker: w.name }))}
                          ref={isPreferred ? preferredWalkerRef : null}
                          style={{
                            position: "relative",
                            flexShrink: 0, padding: "12px 16px", borderRadius: "14px",
                            border: isSelected ? `2px solid ${w.color}` : "1.5px solid #e4e7ec",
                            background: isSelected ? `${w.color}10` : "#fff",
                            cursor: "pointer", textAlign: "left", minWidth: "130px",
                            boxShadow: isSelected ? `0 2px 12px ${w.color}22` : "none",
                            transition: "all 0.15s",
                          }}>
                          <div title={dotTitle} style={{
                            position: "absolute", top: "9px", right: "9px",
                            width: "9px", height: "9px", borderRadius: "50%",
                            background: dotColor,
                            boxShadow: `0 0 0 2px #fff, 0 0 0 3px ${dotColor}55`,
                          }} />
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                            <span style={{ fontSize: "20px" }}>{w.avatar}</span>
                            {isPreferred && (
                              <span style={{ fontSize: "16px", background: w.color, color: "#fff",
                                borderRadius: "4px", padding: "1px 5px", fontFamily: "'DM Sans', sans-serif",
                                fontWeight: 700, letterSpacing: "0.5px" }}>YOUR WALKER</span>
                            )}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                            fontSize: "15px", color: "#111827", marginBottom: "2px" }}>{firstName(w.name)}</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: hasAvail ? "#059669" : "#9ca3af" }}>
                            {hasAvail ? `${walkerDateSlots.length} slots open` : "No availability set"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {form.walker && walkerSlotsForDay !== null && walkerSlotsForDay.length === 0 && (
                    <div style={{ marginTop: "10px", padding: "10px 14px", background: "#fff7ed",
                      border: "1.5px solid #fed7aa", borderRadius: "10px",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#b45309" }}>
                      ⚠️ {form.walker} {walkerHasAnyAvailability ? "hasn't set availability for this day" : "hasn't set any availability yet"}. Try a different date or walker.
                    </div>
                  )}
                </div>

                  {/* Walk selector rows */}
                  {(() => {
                    const handoffInfo = client.handoffInfo;

                    // Get minutes-since-midnight for a slot
                    const slotMins = (slot) => slot.hour * 60 + slot.minute;

                    // Check if a slot is blocked by meet & greet or follow-on walk
                    const isHandoffBlocked = (slot) => {
                      if (!handoffInfo?.handoffDate || !handoffInfo?.handoffSlot) return false;

                      // Figure out the date of the selected day being browsed
                      const selectedDateStr = weekDates[selectedDay].toISOString().slice(0, 10);
                      const handoffDateStr  = handoffInfo.handoffDate.slice(0, 10);

                      // Meet & Greet and follow-on blocking only applies on the same calendar date
                      if (selectedDateStr !== handoffDateStr) return false;

                      // Meet & Greet itself is 15 min — block slots that start before meet & greet ends
                      const handoffStartMins = handoffInfo.handoffSlot.hour * 60 + handoffInfo.handoffSlot.minute;
                      const handoffEndMins   = handoffStartMins + 15;
                      const slotStartMins    = slot.hour * 60 + slot.minute;

                      // Block if slot starts before meet & greet ends
                      if (slotStartMins < handoffEndMins) return true;

                      // If a follow-on walk was booked, also block slots that overlap its window
                      const followOn = handoffInfo.followOnWalk;
                      if (followOn) {
                        const followOnStartMins = followOn.hour * 60 + followOn.minute;
                        const followOnDurMins   = followOn.duration === "60 min" ? 60 : 30;
                        const followOnEndMins   = followOnStartMins + followOnDurMins;
                        // Block any slot whose 30-min window overlaps the follow-on walk
                        if (slotStartMins >= followOnStartMins && slotStartMins < followOnEndMins) return true;
                      }

                      return false;
                    };

                    // Get blocked slot IDs from already-booked slots
                    const alreadyBooked = (slotId) => myBookings.some(b => b.key === bookingKey(service, selectedDay, slotId) && !b.cancelled);

                    // Get overlap-blocked times for a given walk index
                    const getBlockedMinsForIndex = (idx) => {
                      const blocked = new Set();
                      selectedWalks.forEach((w, i) => {
                        if (i === idx || !w.slotId || !w.duration) return;
                        const slot = svc.slots.find(s => s.id === w.slotId);
                        if (!slot) return;
                        const start = slotMins(slot);
                        const len = w.duration === "60 min" ? 60 : 30;
                        // Block all 30-min windows that overlap with this walk
                        for (let m = start - 29; m < start + len; m += 30) {
                          blocked.add(Math.round(m / 30) * 30);
                        }
                      });
                      return blocked;
                    };

                    const allValid = selectedWalks.every(w => w.slotId && w.duration);

                    const selectedDate = weekDates[selectedDay]?.toISOString().slice(0, 10);

                    // Build date scroll items (all valid dates, 8 weeks out)
                    const _today = new Date(); _today.setHours(0,0,0,0);
                    const _tomorrow = new Date(_today); _tomorrow.setDate(_today.getDate() + 1);
                    const _cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
                    const _handoffMid = client.handoffInfo?.handoffDate
                      ? (() => { const h = new Date(client.handoffInfo.handoffDate); return new Date(h.getFullYear(), h.getMonth(), h.getDate()); })()
                      : null;
                    const _DN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                    const _MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const dateItems = [];
                    for (let wo = minWeekOffset; wo <= 8; wo++) {
                      const wDts = getWeekDates(wo);
                      for (let di = 0; di < 7; di++) {
                        const d = new Date(wDts[di]);
                        const lastSlot = new Date(d); lastSlot.setHours(19, 0, 0, 0);
                        if (lastSlot <= _cutoff) continue;
                        const dMid = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                        if (_handoffMid && dMid < _handoffMid) continue;
                        const label = dMid.getTime() === _today.getTime() ? "Today"
                          : dMid.getTime() === _tomorrow.getTime() ? "Tomorrow"
                          : `${_DN[d.getDay()]} ${_MN[d.getMonth()]} ${d.getDate()}`;
                        dateItems.push({ id: `${wo}-${di}`, label, weekOffset: wo, dayIndex: di });
                      }
                    }
                    const selectedDateId = `${weekOffset}-${activeDay}`;
                    const colHdr = {
                      textAlign: "center", padding: "6px 0",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "10px",
                      color: "#9ca3af", letterSpacing: "1.5px",
                      textTransform: "uppercase", fontWeight: 600,
                      borderBottom: "1px solid #f0f0f0",
                    };

                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                        {selectedWalks.map((walk, idx) => {
                          const blockedMins = getBlockedMinsForIndex(idx);
                          const cutoff24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
                          const availableSlots = svc.slots.filter(slot => {
                            const slotDt = new Date(weekDates[selectedDay]);
                            slotDt.setHours(slot.hour, slot.minute, 0, 0);
                            return slotDt > cutoff24h &&
                              !isHandoffBlocked(slot) &&
                              !alreadyBooked(slot.id) &&
                              !blockedMins.has(slotMins(slot)) &&
                              !walkerBookedMins.has(slot.hour * 60 + slot.minute) &&
                              (walkerSlotsForDay === null || walkerSlotsForDay.includes(slot.time));
                          });
                          const selectedSlotObj = svc.slots.find(s => s.id === walk.slotId);
                          const basePrice = walk.duration && selectedSlotObj
                            ? getSessionPrice(walk.duration)
                            : null;
                          const price = basePrice;

                          return (
                            <div key={idx}>
                              {/* Banner above scroll picker */}
                              <div style={{
                                background: "#f0f4ff",
                                border: "1.5px solid #d0d9f5",
                                borderRadius: "10px",
                                padding: "10px 14px",
                                marginBottom: "10px",
                                textAlign: "center",
                                fontFamily: "'DM Sans', sans-serif",
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#3b4db8",
                                letterSpacing: "0.01em",
                              }}>
                                Select your Date, Time, and length of walk below.
                              </div>

                              {/* Three-column scroll picker: Date | Time | Duration */}
                              <div style={{ display: "flex", border: "1.5px solid #e4e7ec",
                                borderRadius: "12px", overflow: "hidden", background: "#fff",
                                marginBottom: walk.slotId && walk.duration && price !== null ? "10px" : "0" }}>
                                {/* Date column */}
                                <div style={{ flex: 3, borderRight: "1px solid #e4e7ec" }}>
                                  <div style={colHdr}>Date</div>
                                  <ScrollPicker
                                    key="date-col"
                                    items={dateItems}
                                    value={selectedDateId}
                                    onChange={(val) => {
                                      const found = dateItems.find(it => it.id === val);
                                      if (!found) return;
                                      setWeekOffset(found.weekOffset);
                                      setActiveDay(found.dayIndex);
                                      setSelectedWalk({ slotId: "", duration: "30 min" });
                                    }}
                                    itemHeight={44}
                                    visibleCount={5}
                                    renderItem={(item) => item.label}
                                  />
                                </div>
                                {/* Time column */}
                                <div style={{ flex: 2, borderRight: "1px solid #e4e7ec" }}>
                                  <div style={colHdr}>Time</div>
                                  {availableSlots.length === 0 ? (
                                    <div style={{ height: `${5 * 44}px`, display: "flex",
                                      alignItems: "center", justifyContent: "center",
                                      fontFamily: "'DM Sans', sans-serif",
                                      fontSize: "11px", color: "#d1d5db",
                                      textAlign: "center", padding: "0 6px", lineHeight: 1.4 }}>
                                      None available
                                    </div>
                                  ) : (
                                    <ScrollPicker
                                      key={`time-${activeDay}-${idx}`}
                                      items={availableSlots}
                                      value={walk.slotId}
                                      onChange={(val) => setSelectedWalks(w => w.map((ww, i) =>
                                        i === idx ? { ...ww, slotId: val } : ww
                                      ))}
                                      itemHeight={44}
                                      visibleCount={5}
                                      renderItem={(item) => item.time}
                                    />
                                  )}
                                </div>
                                {/* Duration column */}
                                <div style={{ flex: 1.5 }}>
                                  <div style={colHdr}>Duration</div>
                                  <ScrollPicker
                                    key={`dur-${activeDay}-${idx}`}
                                    items={["30 min", "60 min"]}
                                    value={walk.duration}
                                    onChange={(val) => setSelectedWalks(w => w.map((ww, i) =>
                                      i === idx ? { ...ww, duration: val } : ww
                                    ))}
                                    itemHeight={44}
                                    visibleCount={5}
                                  />
                                </div>
                              </div>
                              {/* Price row */}
                              {walk.slotId && walk.duration && price !== null && (
                                <div className="fade-up" style={{ display: "flex",
                                  alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "4px" }}>
                                  <span style={{ fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "17px", fontWeight: 700, color: svc.color }}>
                                    ${price.toFixed(2)}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}



                        {/* Proceed button */}
                        {allValid && (
                          <button className="fade-up"
                            onClick={() => {
                              const primary = svc.slots.find(s => s.id === selectedWalks[0].slotId);
                              setSelectedSlot({ ...primary, duration: selectedWalks[0].duration });
                              setStep("form");
                            }}
                            style={{ width: "100%", padding: "14px", borderRadius: "12px",
                              border: "none", background: svc.color, color: "#fff",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 500, cursor: "pointer" }}>
                            {form.walker ? `Continue booking with ${firstName(form.walker)} →` : "Continue →"}
                          </button>
                        )}
                      </div>
                    );
                  })()}


                {(() => {
                  const now = new Date();
                  const fmtUpcomingDate = (dt) => {
                    if (!dt) return "";
                    const [y, m, d] = dt.slice(0, 10).split("-").map(Number);
                    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" });
                  };
                  const upcomingBookings = myBookings.filter(b => !b.cancelled && b.scheduledDateTime && new Date(b.scheduledDateTime) > now);
                  return upcomingBookings.length > 0 && (
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                      letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>
                      Your Upcoming Bookings
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {upcomingBookings.map((b, i) => {
                        const s = SERVICES[b.service] || SERVICES["dog"];
                        const policy = getCancellationPolicy(b.scheduledDateTime);
                        return (
                          <button key={i} onClick={() => setSelectedBooking(b)}
                            style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                              borderRadius: "12px", padding: "14px 16px", cursor: "pointer",
                              display: "flex", alignItems: "center", gap: "14px",
                              textAlign: "left", width: "100%",
                              transition: "all 0.15s", boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = s.color; e.currentTarget.style.boxShadow = `0 4px 14px ${s.color}22`; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "#e4e7ec"; e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.04)"; }}>
                            <div style={{ width: "40px", height: "40px", borderRadius: "10px",
                              background: s.light, display: "flex", alignItems: "center",
                              justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>{s.icon}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
                                fontSize: "16px", color: "#111827" }}>
                                {b.form.pet} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({b.form.name})</span>
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                                {s.label} · {b.slot?.duration} · {b.day}{fmtUpcomingDate(b.scheduledDateTime) ? `, ${fmtUpcomingDate(b.scheduledDateTime)}` : ""} at {b.slot?.time}
                              </div>
                              {b.price > 0 && (
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: "#C4541A", fontWeight: 500, marginTop: "2px" }}>
                                  ${Number(b.price).toFixed(2)}{b.sameDayDiscount ? " · 20% off (M&G)" : ""}
                                </div>
                              )}
                              {policy && (
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: policy.color, marginTop: "2px" }}>
                                  {policy.label}
                                </div>
                              )}
                            </div>
                            <div style={{ color: "#d1d5db", fontSize: "18px", flexShrink: 0 }}>›</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  );
                })()}
              </div>
            )}


            {step === "form" && selectedSlot && service !== "overnight" && (
              <div className="fade-up">
                <button onClick={handleReset} style={{ background: "none", border: "none",
                  color: "#6b7280", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", padding: 0, marginBottom: "20px",
                  display: "flex", alignItems: "center", gap: "6px" }}>← Back</button>

                <div style={{ background: svc.light, border: `1.5px solid ${svc.border}`,
                  borderRadius: "14px", padding: "16px 18px", marginBottom: "24px",
                  display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={{ fontSize: "28px" }}>{svc.icon}</span>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                      fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", color: "#111827" }}>{svc.label}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: svc.color }}>
                      {FULL_DAYS[selectedDay]}, {dateStr(selectedDay)} · {selectedSlot?.time} · {selectedSlot?.duration}
                    </div>
                  </div>
                </div>

                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                  letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "16px" }}>
                  Your Details
                </div>

                {[
                  { key: "name", label: "Your Name", placeholder: "Full name", type: "text" },
                  { key: "email", label: "Email Address", placeholder: "you@example.com", type: "email" },
                  { key: "phone", label: `Phone Number${client.phone ? " (optional)" : ""}`, placeholder: "+1 (555) 000-0000", type: "tel" },
                ].map(field => (
                  <div key={field.key} style={{ marginBottom: field.key === "phone" ? "6px" : "14px" }}>
                    <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "16px", fontWeight: 500,
                      color: errors[field.key] ? "#dc2626" : "#374151", marginBottom: "6px" }}>
                      {field.label}{errors[field.key] && <span style={{ fontWeight: 400, fontSize: "15px",
                        marginLeft: "6px", color: "#dc2626" }}>— {errors[field.key]}</span>}
                    </label>
                    <input type={field.type} placeholder={field.placeholder} value={form[field.key]}
                      onChange={e => { setForm(p => ({ ...p, [field.key]: e.target.value })); setErrors(p => ({ ...p, [field.key]: "" })); }}
                      style={{ width: "100%", padding: "12px 14px", borderRadius: "10px",
                        border: errors[field.key] ? "1.5px solid #dc2626" : "1.5px solid #d1d5db",
                        background: "#fff", fontSize: "15px", fontFamily: "'DM Sans', sans-serif",
                        color: "#111827", transition: "border-color 0.15s" }}
                      onFocus={e => e.target.style.borderColor = svc.color}
                      onBlur={e => e.target.style.borderColor = errors[field.key] ? "#dc2626" : "#d1d5db"} />
                    {field.key === "phone" && (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "7px",
                        marginTop: "8px", marginBottom: "8px", padding: "10px 12px",
                        background: "#FDF5EC", borderRadius: "8px", border: "1px solid #D4A87A" }}>
                        <span style={{ fontSize: "15px", flexShrink: 0, marginTop: "1px" }}>🔒</span>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#9B7444", lineHeight: "1.5" }}>
                          We will never solicit or sell your phone number for any reason. It will only be used to contact you regarding your pet services.
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Pet name(s) */}
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 500,
                      color: errors.pet ? "#dc2626" : "#374151" }}>
                      {service === "dog" ? "Dog(s) on This Walk" : "Cat's Name"}
                      {errors.pet && <span style={{ fontWeight: 400, fontSize: "15px",
                        marginLeft: "6px", color: "#dc2626" }}>— {errors.pet}</span>}
                    </label>
                    {service === "dog" && additionalDogs.length < 4 && (
                      <button onClick={() => setAdditionalDogs(d => [...d, ""])}
                        style={{ background: "none", border: "1px solid #D4A87A", borderRadius: "6px",
                          padding: "3px 10px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", color: "#C4541A", fontWeight: 500 }}>
                        + Add Dog
                      </button>
                    )}
                  </div>

                  {/* Primary pet */}
                  {savedPets.length > 1 ? (
                    <div style={{ display: "flex", gap: "8px", marginBottom: additionalDogs.length > 0 ? "8px" : "0" }}>
                      <select
                        value={savedPets.includes(form.pet) ? form.pet : "__new__"}
                        onChange={e => {
                          if (e.target.value === "__new__") setForm(p => ({ ...p, pet: "" }));
                          else setForm(p => ({ ...p, pet: e.target.value }));
                          setErrors(p => ({ ...p, pet: "" }));
                        }}
                        style={{ flex: 1, padding: "12px 14px", borderRadius: "10px",
                          border: errors.pet ? "1.5px solid #dc2626" : "1.5px solid #d1d5db",
                          background: "#fff", fontSize: "16px", fontFamily: "'DM Sans', sans-serif",
                          color: "#111827", cursor: "pointer", appearance: "none" }}
                        onFocus={e => e.target.style.borderColor = svc.color}
                        onBlur={e => e.target.style.borderColor = errors.pet ? "#dc2626" : "#d1d5db"}>
                        {savedPets.map(p => <option key={p} value={p}>{p}</option>)}
                        <option value="__new__">+ Different dog…</option>
                      </select>
                      {!savedPets.includes(form.pet) && (
                        <input type="text" placeholder="Dog's name" value={form.pet}
                          onChange={e => { setForm(p => ({ ...p, pet: e.target.value })); setErrors(p => ({ ...p, pet: "" })); }}
                          style={{ flex: 1, padding: "12px 14px", borderRadius: "10px",
                            border: errors.pet ? "1.5px solid #dc2626" : "1.5px solid #d1d5db",
                            background: "#fff", fontSize: "15px", fontFamily: "'DM Sans', sans-serif", color: "#111827" }}
                          onFocus={e => e.target.style.borderColor = svc.color}
                          onBlur={e => e.target.style.borderColor = errors.pet ? "#dc2626" : "#d1d5db"} />
                      )}
                    </div>
                  ) : (
                    <input type="text" placeholder={service === "dog" ? "Dog's name" : "Cat's name"} value={form.pet}
                      onChange={e => { setForm(p => ({ ...p, pet: e.target.value })); setErrors(p => ({ ...p, pet: "" })); }}
                      style={{ width: "100%", padding: "12px 14px", borderRadius: "10px",
                        border: errors.pet ? "1.5px solid #dc2626" : "1.5px solid #d1d5db",
                        background: "#fff", fontSize: "15px", fontFamily: "'DM Sans', sans-serif",
                        color: "#111827", transition: "border-color 0.15s",
                        marginBottom: additionalDogs.length > 0 ? "8px" : "0" }}
                      onFocus={e => e.target.style.borderColor = svc.color}
                      onBlur={e => e.target.style.borderColor = errors.pet ? "#dc2626" : "#d1d5db"} />
                  )}

                  {/* Additional dogs */}
                  {service === "dog" && additionalDogs.map((dog, i) => (
                    <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                      <div style={{ display: "flex", gap: "8px", flex: 1 }}>
                        {savedDogs.length > 0 ? (
                          <>
                            <select
                              value={savedDogs.includes(dog) ? dog : "__new__"}
                              onChange={e => {
                                const val = e.target.value === "__new__" ? "" : e.target.value;
                                setAdditionalDogs(d => d.map((x, j) => j === i ? val : x));
                              }}
                              style={{ flex: 1, padding: "12px 14px", borderRadius: "10px",
                                border: "1.5px solid #d1d5db", background: "#fff", fontSize: "16px",
                                fontFamily: "'DM Sans', sans-serif", color: "#111827", cursor: "pointer", appearance: "none" }}
                              onFocus={e => e.target.style.borderColor = svc.color}
                              onBlur={e => e.target.style.borderColor = "#d1d5db"}>
                              {savedDogs.filter(p => p !== form.pet && !additionalDogs.filter((_, j) => j !== i).includes(p)).map(p => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                              <option value="__new__">+ Different dog…</option>
                            </select>
                            {!savedDogs.filter(p => p !== form.pet).includes(dog) && (
                              <input type="text" placeholder="Dog's name" value={dog}
                                onChange={e => setAdditionalDogs(d => d.map((x, j) => j === i ? e.target.value : x))}
                                style={{ flex: 1, padding: "12px 14px", borderRadius: "10px",
                                  border: "1.5px solid #d1d5db", background: "#fff", fontSize: "15px",
                                  fontFamily: "'DM Sans', sans-serif", color: "#111827" }}
                                onFocus={e => e.target.style.borderColor = svc.color}
                                onBlur={e => e.target.style.borderColor = "#d1d5db"} />
                            )}
                          </>
                        ) : (
                          <input type="text" placeholder="Dog's name" value={dog}
                            onChange={e => setAdditionalDogs(d => d.map((x, j) => j === i ? e.target.value : x))}
                            style={{ flex: 1, padding: "12px 14px", borderRadius: "10px",
                              border: "1.5px solid #d1d5db", background: "#fff", fontSize: "15px",
                              fontFamily: "'DM Sans', sans-serif", color: "#111827" }}
                            onFocus={e => e.target.style.borderColor = svc.color}
                            onBlur={e => e.target.style.borderColor = "#d1d5db"} />
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#C4541A", fontWeight: 600, whiteSpace: "nowrap" }}>+$10</div>
                        <button onClick={() => setAdditionalDogs(d => d.filter((_, j) => j !== i))}
                          style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px",
                            width: "28px", height: "28px", cursor: "pointer", color: "#dc2626",
                            fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                      </div>
                    </div>
                  ))}

                  {/* Additional dog charge summary */}
                  {service === "dog" && additionalDogs.length > 0 && (
                    <div style={{ marginTop: "8px", padding: "8px 12px", background: "#FDF5EC",
                      borderRadius: "8px", border: "1px solid #D4A87A",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#C4541A" }}>
                      +${additionalDogs.length * 10} additional dog charge ({additionalDogs.length} extra dog{additionalDogs.length !== 1 ? "s" : ""} × $10)
                    </div>
                  )}

                  {savedPets.length === 1 && additionalDogs.length === 0 && (
                    <div style={{ marginTop: "6px", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", color: "#9ca3af" }}>
                      Clear the name above to book for a different pet — they'll be saved for next time.
                    </div>
                  )}
                </div>

                {/* Address */}
                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "16px", fontWeight: 500,
                    color: errors.address ? "#dc2626" : "#374151", marginBottom: "8px" }}>
                    Home Address{errors.address && <span style={{ fontWeight: 400, fontSize: "15px",
                      marginLeft: "6px", color: "#dc2626" }}>— {errors.address}</span>}
                  </label>
                  <AddressFields
                    value={form.addrObj}
                    onChange={(obj, str) => {
                      setForm(p => ({ ...p, addrObj: obj, address: str }));
                      setErrors(p => ({ ...p, address: "" }));
                    }}
                    errors={errors.address ? { street: errors.address } : {}}
                  />
                </div>


                {/* Notes */}
                <div style={{ marginBottom: "24px" }}>
                  <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "16px", fontWeight: 500, color: "#374151", marginBottom: "6px" }}>
                    Special Instructions (optional)
                  </label>
                  <textarea placeholder={service === "dog" ? "Leash preference, allergies, behavior notes…" : "Feeding schedule, litter box location, any quirks…"}
                    value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={3}
                    style={{ width: "100%", padding: "12px 14px", borderRadius: "10px",
                      border: "1.5px solid #d1d5db", background: "#fff", fontSize: "15px",
                      fontFamily: "'DM Sans', sans-serif", color: "#111827", resize: "vertical" }}
                    onFocus={e => e.target.style.borderColor = svc.color}
                    onBlur={e => e.target.style.borderColor = "#d1d5db"} />
                </div>

                {/* Recurring toggle */}
                <div onClick={() => setIsRecurring(r => !r)} style={{
                  marginBottom: "16px", padding: "14px 16px", borderRadius: "12px",
                  border: isRecurring ? "2px solid #8B5E3C" : "1.5px solid #d1d5db",
                  background: isRecurring ? "#FDF5EC" : "#fff",
                  cursor: "pointer", display: "flex", alignItems: "center",
                  gap: "14px", transition: "all 0.15s",
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                      fontSize: "16px", color: "#111827", marginBottom: "2px" }}>
                      🔁 Repeat weekly
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#6b7280", lineHeight: "1.5" }}>
                      Book this same slot every week until you cancel.
                    </div>
                  </div>
                  {/* Toggle pill */}
                  <div style={{
                    width: "44px", height: "24px", borderRadius: "12px", flexShrink: 0,
                    background: isRecurring ? "#C4541A" : "#d1d5db",
                    position: "relative", transition: "background 0.2s",
                  }}>
                    <div style={{
                      position: "absolute", top: "3px",
                      left: isRecurring ? "23px" : "3px",
                      width: "18px", height: "18px", borderRadius: "50%",
                      background: "#fff", transition: "left 0.2s",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                    }} />
                  </div>
                </div>

                {submitError && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px",
                    padding: "12px 16px", marginBottom: "12px", display: "flex", alignItems: "flex-start", gap: "10px" }}>
                    <span style={{ fontSize: "18px", lineHeight: 1 }}>⚠️</span>
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                        fontWeight: 600, color: "#991b1b", marginBottom: "2px" }}>Booking not saved</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#b91c1c", lineHeight: 1.5 }}>
                        {submitError}
                      </div>
                    </div>
                  </div>
                )}
                <button onClick={handleSubmit} disabled={submitting} style={{ width: "100%",
                  padding: "16px", borderRadius: "12px", border: "none", background: svc.color,
                  color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 500, cursor: submitting ? "wait" : "pointer" }}>
                  {submitting
                    ? (requiresPayment ? "Redirecting to Payment…" : "Confirming…")
                    : requiresPayment
                      ? `🔒 Proceed to Payment`
                      : isRecurring
                        ? `Confirm Weekly ${svc.label}${form.walker ? ` with ${firstName(form.walker)}` : ""}`
                        : `Confirm ${svc.label} Appointment${form.walker ? ` with ${firstName(form.walker)}` : ""}`}
                </button>
              </div>
            )}


            {/* CONFIRM STEP — full-screen overlay */}
            {step === "confirm" && service !== "overnight" && (
              <div className="fade-up" style={{
                position: "fixed", inset: 0, zIndex: 200,
                background: "rgba(15,31,20,0.72)",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "20px",
              }}>
                <div style={{
                  background: "#fff", borderRadius: "20px", width: "100%",
                  maxWidth: "480px", maxHeight: "90vh", overflowY: "auto",
                  padding: "32px 28px", boxShadow: "0 8px 48px rgba(0,0,0,0.28)",
                  textAlign: "center",
                }}>
                  {/* Success mark */}
                  <div className="pop" style={{ fontSize: "56px", marginBottom: "12px" }}>✓</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "#111827", marginBottom: "6px" }}>
                    {(walksByDay[activeDay] || []).filter(w => w.slotId && w.duration).length > 1
                      ? "Appointments Confirmed" : "Appointment Confirmed"}
                  </div>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", color: "#6b7280",
                    fontSize: "15px", marginBottom: "24px", lineHeight: "1.6" }}>
                    A confirmation will be sent to <strong style={{ color: "#374151" }}>{form.email}</strong>.
                  </p>

                  {/* Booking summary card */}
                  <div style={{ background: "#f9fafb", border: "1.5px solid #e4e7ec",
                    borderRadius: "14px", padding: "18px", textAlign: "left", marginBottom: "24px" }}>
                    <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "14px" }}>
                      <div style={{ width: "42px", height: "42px", borderRadius: "10px",
                        background: svc.light, display: "flex", alignItems: "center",
                        justifyContent: "center", fontSize: "22px", flexShrink: 0 }}>{svc.icon}</div>
                      <div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", color: "#111827" }}>{svc.label}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: svc.color }}>
                          {`${FULL_DAYS[activeDay]}, ${dateStr(activeDay)}`}
                        </div>
                      </div>
                    </div>

                    {/* Single booking summary */}
                    {selectedWalk.slotId && selectedWalk.duration && (() => {
                      const slot = svc.slots.find(s => s.id === selectedWalk.slotId);
                      const p = getSessionPrice(selectedWalk.duration);
                      return (
                        <div style={{ background: svc.light, border: `1px solid ${svc.border}`,
                          borderRadius: "10px", padding: "10px 12px", marginBottom: "12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#374151" }}>
                            <span>{slot?.time} · {selectedWalk.duration}</span>
                            <span style={{ fontWeight: 600, color: "#111827" }}>${p}</span>
                          </div>
                        </div>
                      );
                    })()}

                    {isRecurring && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px",
                        padding: "8px 12px", borderRadius: "8px", marginBottom: "10px",
                        background: "#FDF5EC", border: "1.5px solid #D4A87A" }}>
                        <span style={{ fontSize: "16px" }}>🔁</span>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#C4541A", lineHeight: "1.5" }}>
                          <strong>Recurring weekly</strong> — booked every {FULL_DAYS[activeDay]} until cancelled.
                        </span>
                      </div>
                    )}

                    {[
                      ["Client", form.name],
                      [service === "dog" ? "Dog" : "Cat", form.pet],
                      selectedWalks.filter(w=>w.slotId&&w.duration).length === 1 && ["Duration", selectedWalks[0]?.duration || ""],
                      (() => {
                        const validWalks = selectedWalks.filter(w => w.slotId && w.duration);
                        const selectedDate = weekDates[selectedDay]?.toISOString().slice(0, 10);
                        const newKeys = validWalks.map(w => bookingKey(service, selectedDay, w.slotId));
                        const totalBase = validWalks.reduce((sum, w) =>
                          sum + getSessionPrice(w.duration), 0) + additionalDogs.length * 10;
                        const finalPrice = totalBase;
                        const dogNote = additionalDogs.length > 0 ? ` + $${additionalDogs.length * 10} extra dog${additionalDogs.length !== 1 ? "s" : ""}` : "";
                        return [validWalks.length > 1 ? "Total Price" : "Session Price", `${fmt(finalPrice, true)}${dogNote ? ` (${dogNote.trim()})` : ""}`];
                      })(),
                      additionalDogs.filter(d => d.trim()).length > 0 && ["Additional Dogs", additionalDogs.filter(d => d.trim()).join(", ")],
                      form.walker && ["Walker", firstName(form.walker)],
                      form.notes && ["Notes", form.notes],
                    ].filter(Boolean).map(([label, val]) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between",
                        borderTop: "1px solid #f0f0f0", paddingTop: "8px", marginTop: "8px" }}>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>{label}</span>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#374151",
                          textAlign: "right", maxWidth: "60%" }}>{val}</span>
                      </div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <button onClick={handleReset}
                      style={{ width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                        background: svc.color, color: "#fff",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        fontWeight: 600, cursor: "pointer" }}>
                      + Book More Appointments
                    </button>
                    <button onClick={() => { handleReset(); setPage("mywalks"); }}
                      style={{ width: "100%", padding: "14px", borderRadius: "12px",
                        border: `1.5px solid ${svc.color}`, background: "transparent",
                        color: svc.color, fontFamily: "'DM Sans', sans-serif",
                        fontSize: "16px", fontWeight: 500, cursor: "pointer" }}>
                      View My Walks
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
        );   // close return() for normal booking path
      })()}  {/* close IIFE for page === "book" */}
      </div>{/* end scrollable content */}
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

export default BookingApp;
