import { useState, useEffect, useRef, useMemo } from "react";
import { SERVICES, SERVICE_SLOTS, DAYS, FULL_DAYS, WALKER_SERVICES, ALL_HANDOFF_SLOTS } from "../../constants.js";
import {
  saveClients, saveWalkerProfiles, notifyAdmin, saveTrades,
  loadChatMessages, saveChatMessage, formatChatTime,
  loadDirectMessages, saveDirectMessage,
  loadWalkerAvailability, saveWalkerAvailabilityDay,
  loadCompletedPayrolls, saveCompletedPayrolls,
  loadClientMessages, saveClientMessage, saveInvoiceToDB,
} from "../../supabase.js";
import {
  effectivePrice, getWalkerPayout,
  getCurrentWeekRange, getWeekRangeForOffset,
  getBookingWeekKey, getWeekBookingCountForOffset,
  getPriceTier, getSessionPrice, getCancellationPolicy,
  repriceWeekBookings, applySameDayDiscount,
  getWeekDates, firstName, parseDateLocal, dateStrFromDate,
  fmt, formatPhone, addrToString, addrFromString, emptyAddr, toDateKey,
} from "../../helpers.js";
import LogoBadge from "../shared/LogoBadge.jsx";
import AddressFields from "../shared/AddressFields.jsx";
import WalkerClientEditor from "./WalkerClientEditor.jsx";
import { slotsToShifts, shiftsToSlots, ShiftSlider, DayAvailSliders, AVAIL_SLIDER_CSS } from "./AvailabilityComponents.jsx";
import { autoCreateWalkInvoice, generateInvoiceId, invoiceStatusMeta } from "../invoices/invoiceHelpers.js";
import { spawnNextRecurringOccurrence } from "../recurring.js";
import { GLOBAL_STYLES } from "../../styles.js";
import { WALKER_CREDENTIALS, getAllWalkers } from "../auth/WalkerAuthScreen.jsx";
import AddLegacyClientForm from "../admin/AddLegacyClientForm.jsx";
import ScheduleWalkForm from "../admin/ScheduleWalkForm.jsx";
import Header from "../shared/Header.jsx";

// ─── Walker Dashboard ─────────────────────────────────────────────────────────
function WalkerDashboard({ walker, clients, setClients, walkerProfiles, setWalkerProfiles, trades, setTrades, onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const [pendingNavTab, setPendingNavTab] = useState(null);
  const [walkerMenuOpen, setWalkerMenuOpen] = useState(false);
  const [invFilter, setInvFilter] = useState("all");
  const [walkerWalksSearch, setWalkerWalksSearch] = useState("");
  const [walkerTradesSearch, setWalkerTradesSearch] = useState("");
  const [walkerMsgsSearch, setWalkerMsgsSearch] = useState("");
  // New calendar-based availability: { "2025-04-07": ["8:00 AM", ...], ... }
  const [availability, setAvailability] = useState({});
  const [availLoading, setAvailLoading] = useState(false);
  const [availWeekOffset, setAvailWeekOffset] = useState(0);
  const [copySourceDate, setCopySourceDate] = useState(null);
  const [copyTargetDates, setCopyTargetDates] = useState([]);
  const [importPickerKey, setImportPickerKey] = useState(null); // dateKey of day showing "import from" picker
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatLastSeenAt, setChatLastSeenAt] = useState(() => {
    try { return localStorage.getItem(`dwi_chat_seen_${walker?.id || 0}`) || ""; } catch { return ""; }
  });
  const chatPollRef = useRef(null);
  const chatBottomRef = useRef(null);
  const chatContainerRef = useRef(null);
  const [chatInput, setChatInput] = useState("");

  // ── Walker ↔ Walker DM state ──
  const [msgSubTab, setMsgSubTab] = useState("team");
  const [dmThread, setDmThread] = useState(null); // name of walker we're DMing
  const [dmMessages, setDmMessages] = useState([]);
  const [dmInput, setDmInput] = useState("");
  const [dmLoading, setDmLoading] = useState(false);
  const dmPollRef = useRef(null);
  const dmBottomRef = useRef(null);
  const dmContainerRef = useRef(null);
  const [dmSeenMap, setDmSeenMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dwi_dm_seen_${walker?.id || 0}`) || "{}"); } catch { return {}; }
  });

  // ── Walker ↔ Client direct messaging state ──
  const [selectedClientMsgEmail, setSelectedClientMsgEmail] = useState(null);
  const [clientMsgsByEmail, setClientMsgsByEmail]           = useState({});
  const [clientMsgInput, setClientMsgInput]                 = useState("");
  const [clientMsgLoading, setClientMsgLoading]             = useState(false);
  const clientMsgPollRef      = useRef(null);
  const clientMsgBottomRef    = useRef(null);
  const clientMsgContainerRef = useRef(null);
  const [clientMsgSeenMap, setClientMsgSeenMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dwi_walker_client_msg_seen_${walker.id}`) || "{}"); } catch { return {}; }
  });
  // trades come from shared persistent storage (prop)
  const [payoutFilter, setPayoutFilter] = useState("week");
  const [expandedWalkKey, setExpandedWalkKey] = useState(null);
  const [completingWalkKey, setCompletingWalkKey] = useState(null);
  const [undoingWalkKey, setUndoingWalkKey] = useState(null);
  const [earlyAckKey, setEarlyAckKey] = useState(null);
  const [confirmMarkAll, setConfirmMarkAll] = useState(false);
  const [claimingKey, setClaimingKey] = useState(null);
  const [showAddClient, setShowAddClient] = useState(false); // key of walk pending claim confirmation
  const [claimAcknowledged, setClaimAcknowledged] = useState(false);
  // My Info tab state
  const myProfile = (walkerProfiles && walkerProfiles[walker.id]) || {};
  const [infoForm, setInfoForm] = useState({
    preferredName: myProfile.preferredName || walker.name || "",
    email: myProfile.email || walker.email || "",
    phone: myProfile.phone || "",
    address: myProfile.address || "",
    addrObj: myProfile.addrObj || addrFromString(myProfile.address || ""),
    preferredAvailability: myProfile.preferredAvailability || "",
    preferredDays: myProfile.preferredDays || [],
    notes: myProfile.notes || "",
    pendingBio: myProfile.pendingBio || "",
    services: myProfile.services || [],
  });
  const [infoSaved, setInfoSaved] = useState(false);
  const [infoEditing, setInfoEditing] = useState(false);
  // PIN change state (lifted from My Info tab to satisfy Rules of Hooks)
  const [pinStage, setPinStage]     = useState("idle");
  const [currentPin, setCurrentPin] = useState("");
  const [newPinVal, setNewPinVal]   = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinErrors, setPinErrors]   = useState({});
  // Shift Trades form state (lifted to avoid focus-loss bug)
  const [offerBookingKey, setOfferBookingKey] = useState(null);
  const [offerBonus, setOfferBonus] = useState("");
  const [offerReason, setOfferReason] = useState("");
  const [offerKeySwap, setOfferKeySwap] = useState(false);

  // Gather all bookings across clients, flatten with client info
  const allBookings = [];
  Object.values(clients).forEach(c => {
    (c.bookings || []).forEach(b => {
      if (!b.cancelled) allBookings.push({ ...b, clientId: c.id, clientName: c.name, clientEmail: c.email, clientAddress: c.address || "", clientKeyholder: c.keyholder || "" });
    });
  });

  // Available: not yet assigned to any walker, upcoming, not completed
  const now = new Date();
  const availableWalks = allBookings.filter(b => {
    const appt = new Date(b.scheduledDateTime || b.bookedAt);
    return appt > now && !b.adminCompleted && (!b.form?.walker || b.form.walker === "");
  });

  // Unclaimed meet & greet appointments — no walker assigned yet, in the future
  const unclaimedHandoffs = Object.values(clients)
    .filter(c => {
      if (!c.handoffInfo?.handoffDate || !c.handoffInfo?.handoffSlot) return false;
      if (c.handoffInfo?.handoffWalker) return false; // already claimed
      const appt = new Date(c.handoffInfo.handoffDate);
      return appt > now;
    })
    .map(c => ({
      key: `__handoff_unclaimed__${c.id}`,
      isHandoff: true,
      isUnclaimedHandoff: true,
      clientId: c.id,
      clientName: c.name,
      clientEmail: c.email,
      service: "handoff",
      day: new Date(c.handoffInfo.handoffDate).toLocaleDateString("en-US", { weekday: "long" }),
      date: new Date(c.handoffInfo.handoffDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      slot: { time: c.handoffInfo.handoffSlot?.time || "", duration: "15 min" },
      form: { walker: "", pet: "", name: c.name },
      scheduledDateTime: c.handoffInfo.handoffDate,
      price: 0,
    }));

  // My assigned walks — upcoming AND not yet marked complete
  const myWalksAll = allBookings.filter(b => {
    const appt = new Date(b.scheduledDateTime || b.bookedAt);
    return !b.adminCompleted && appt > now && b.form?.walker === walker.name;
  });

  // Pending meet & greet appointments assigned to this walker
  const myHandoffs = Object.values(clients)
    .filter(c => !c.handoffConfirmed && c.handoffInfo?.handoffDate && c.handoffInfo?.handoffWalker === walker.name)
    .map(c => ({
      key: `__handoff__${c.id}`,
      isHandoff: true,
      clientId: c.id,
      clientName: c.name,
      service: "handoff",
      day: new Date(c.handoffInfo.handoffDate).toLocaleDateString("en-US", { weekday: "long" }),
      date: new Date(c.handoffInfo.handoffDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      slot: { time: c.handoffInfo.handoffSlot?.time || "", duration: "15 min" },
      form: { walker: walker.name, pet: "", name: c.name },
      scheduledDateTime: c.handoffInfo.handoffDate,
      price: null,
    }));

  // For recurring series, only show the next 3 upcoming per recurringId to keep My Schedule clean
  const myWalks = (() => {
    const recurringCountByID = {};
    const result = [];
    // Sort by date ascending so we keep the soonest 3
    const sorted = [...myWalksAll, ...myHandoffs].sort((a, b) =>
      new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt)
    );
    sorted.forEach(b => {
      if (b.isRecurring && b.recurringId) {
        recurringCountByID[b.recurringId] = (recurringCountByID[b.recurringId] || 0) + 1;
        if (recurringCountByID[b.recurringId] > 3) return; // cap at 3 per series
      }
      result.push(b);
    });
    return result;
  })();

  // Completed walks: adminCompleted flag OR past-due, assigned to this walker
  const completedWalks = allBookings.filter(b => {
    if (b.form?.walker !== walker.name) return false;
    if (b.adminCompleted) return true;
    const appt = new Date(b.scheduledDateTime || b.bookedAt);
    return appt <= now;
  });

  // Compute earnings
  const totalEarned = completedWalks.reduce((sum, b) => sum + getWalkerPayout(b), 0);
  const thisWeek = completedWalks.filter(b => {
    const appt = new Date(b.scheduledDateTime || b.bookedAt);
    const { monday, sunday } = getCurrentWeekRange();
    return appt >= monday && appt <= sunday;
  });
  const weekEarned = thisWeek.reduce((sum, b) => sum + getWalkerPayout(b), 0);

  const accentBlue = "#3D6B7A";

  const [claimedKeys, setClaimedKeys] = useState(new Set());

  const claimWalk = (booking) => {
    if (!setClients) return;
    // Find which client owns this booking
    const clientId = booking.clientId || Object.keys(clients).find(cid =>
      (clients[cid].bookings || []).some(bk => bk.key === booking.key)
    );
    if (!clientId || !clients[clientId]) return;

    // Optimistic UI: mark as claimed immediately
    setClaimedKeys(prev => new Set([...prev, booking.key]));

    const updated = {
      ...clients,
      [clientId]: {
        ...clients[clientId],
        bookings: (clients[clientId].bookings || []).map(bk =>
          bk.key === booking.key
            ? { ...bk, form: { ...bk.form, walker: walker.name } }
            : bk
        ),
      },
    };
    setClients(updated);
  };

  const claimHandoff = (handoff) => {
    if (!setClients) return;
    const cid = handoff.clientId;
    if (!cid || !clients[cid]) return;
    setClaimedKeys(prev => new Set([...prev, handoff.key]));
    const clientRecord = clients[cid];
    // Auto-assign this walker to all unassigned bookings for this client
    const updatedBookings = (clientRecord.bookings || []).map(b => {
      if (b.cancelled || b.adminCompleted) return b;
      if (b.form?.walker && b.form.walker !== "") return b; // already assigned
      return { ...b, form: { ...b.form, walker: walker.name } };
    });
    const updated = {
      ...clients,
      [cid]: {
        ...clientRecord,
        keyholder: walker.name,
        preferredWalker: walker.name,
        bookings: updatedBookings,
        handoffInfo: {
          ...clientRecord.handoffInfo,
          handoffWalker: walker.name,
        },
      },
    };
    setClients(updated);
    saveClients(updated);
  };

  const markWalkCompleted = (targetBooking) => {
    if (!setClients) return;
    const clientId = targetBooking.clientId || Object.keys(clients).find(cid =>
      (clients[cid].bookings || []).some(bk => bk.key === targetBooking.key)
    );
    if (!clientId) return;
    const clientRecord = clients[clientId];
    const completedAt = new Date().toISOString();

    // Mark the booking complete
    let updatedBookings = (clientRecord.bookings || []).map(bk =>
      bk.key === targetBooking.key
        ? { ...bk, adminCompleted: true, completedAt, walkerMarkedComplete: true }
        : bk
    );

    // If recurring, spawn the next occurrence so the series continues indefinitely
    if (targetBooking.isRecurring) {
      const updatedClient = { ...clientRecord, bookings: updatedBookings };
      const next = spawnNextRecurringOccurrence(updatedClient, targetBooking);
      if (next) {
        updatedBookings = applySameDayDiscount(repriceWeekBookings([...updatedBookings, next]));
      }
    }

    // Auto-generate invoice on completion
    const completedBooking = { ...targetBooking, completedAt };
    const updatedClientRecord = autoCreateWalkInvoice(
      { ...clientRecord, bookings: updatedBookings },
      completedBooking
    );

    // Persist new invoice to the dedicated DB table
    const existingIds = new Set((clientRecord.invoices || []).map(i => i.id));
    const newInv = (updatedClientRecord.invoices || []).find(i => !existingIds.has(i.id));
    if (newInv) saveInvoiceToDB(newInv, clientId, clientRecord.name || "", clientRecord.email || "");

    const updated = { ...clients, [clientId]: updatedClientRecord };
    setClients(updated);
    saveClients(updated);
    setExpandedWalkKey(null);
    setCompletingWalkKey(null);
  };

  const markAllTodayCompleted = (todayWalksList) => {
    if (!setClients) return;
    const now = new Date().toISOString();
    let updated = { ...clients };
    todayWalksList.forEach(targetBooking => {
      if (targetBooking.walkerMarkedComplete) return; // already done
      const clientId = targetBooking.clientId || Object.keys(updated).find(cid =>
        (updated[cid].bookings || []).some(bk => bk.key === targetBooking.key)
      );
      if (!clientId) return;
      const clientRecord = updated[clientId];
      let updatedBookings = (clientRecord.bookings || []).map(bk =>
        bk.key === targetBooking.key
          ? { ...bk, adminCompleted: true, completedAt: now, walkerMarkedComplete: true }
          : bk
      );
      if (targetBooking.isRecurring) {
        const updatedClient = { ...clientRecord, bookings: updatedBookings };
        const next = spawnNextRecurringOccurrence(updatedClient, targetBooking);
        if (next) {
          updatedBookings = applySameDayDiscount(repriceWeekBookings([...updatedBookings, next]));
        }
      }
      // Auto-generate invoice on completion
      const completedBooking = { ...targetBooking, completedAt: now };
      const existingIds = new Set((clientRecord.invoices || []).map(i => i.id));
      updated[clientId] = autoCreateWalkInvoice(
        { ...clientRecord, bookings: updatedBookings },
        completedBooking
      );
      // Persist new invoice to the dedicated DB table
      const newInv = (updated[clientId].invoices || []).find(i => !existingIds.has(i.id));
      if (newInv) saveInvoiceToDB(newInv, clientId, clientRecord.name || "", clientRecord.email || "");
    });
    setClients(updated);
    saveClients(updated);
    setExpandedWalkKey(null);
    setCompletingWalkKey(null);
  };

  const undoWalkCompletion = (targetBooking) => {
    if (!setClients) return;
    const clientId = targetBooking.clientId || Object.keys(clients).find(cid =>
      (clients[cid].bookings || []).some(bk => bk.key === targetBooking.key)
    );
    if (!clientId) return;
    const updated = {
      ...clients,
      [clientId]: {
        ...clients[clientId],
        bookings: (clients[clientId].bookings || []).map(bk =>
          bk.key === targetBooking.key
            ? { ...bk, adminCompleted: false, completedAt: undefined, walkerMarkedComplete: false }
            : bk
        ),
      },
    };
    setClients(updated);
    saveClients(updated);
    setUndoingWalkKey(null);
  };


  // Load availability from Supabase when tab opens
  useEffect(() => {
    if (tab !== "availability") return;
    setAvailLoading(true);
    loadWalkerAvailability(walker.id).then(data => {
      setAvailability(data);
      setSavedAvailability(data);
      setAvailLoading(false);
    });
  }, [tab, walker.id]);

  // Get the 7 calendar dates for the current availability week offset
  const availWeekDates = getWeekDates(availWeekOffset);
  const prevWeekDates  = getWeekDates(availWeekOffset - 1); // same 7-day window, one week back
  const [availSaving, setAvailSaving] = useState(false);
  const [availSaved, setAvailSaved] = useState(false);
  const [savedAvailability, setSavedAvailability] = useState({});
  const [sameAsLastWeekFlash, setSameAsLastWeekFlash] = useState(false);

  // Guarded tab navigation — prompts if leaving availability with unsaved changes
  const changeTab = (newTab) => {
    if (tab === "availability") {
      const allKeys = new Set([...Object.keys(availability), ...Object.keys(savedAvailability)]);
      const dirty = [...allKeys].some(dk =>
        JSON.stringify(availability[dk] || []) !== JSON.stringify(savedAvailability[dk] || [])
      );
      if (dirty) { setPendingNavTab(newTab); return; }
    }
    setTab(newTab);
    document.querySelector("[data-scroll-pane]")?.scrollTo({ top: 0, behavior: "instant" });
  };

  // Toggle slot locally only — save happens on button click
  const toggleAvailabilityDate = (dateKey, slot) => {
    const current = availability[dateKey] || [];
    const updated = current.includes(slot) ? current.filter(s => s !== slot) : [...current, slot];
    setAvailability(prev => ({ ...prev, [dateKey]: updated }));
    setAvailSaved(false);
  };

  const isAllSelectedDate = (dateKey) => TAB_SLOTS.every(s => (availability[dateKey] || []).includes(s));

  const toggleSelectAllDate = (dateKey) => {
    const updated = isAllSelectedDate(dateKey) ? [] : [...TAB_SLOTS];
    setAvailability(prev => ({ ...prev, [dateKey]: updated }));
    setAvailSaved(false);
  };

  const applyCopyDate = () => {
    if (!copySourceDate || copyTargetDates.length === 0) return;
    const sourceKey = copySourceDate;
    const targets   = [...copyTargetDates];
    setAvailability(prev => {
      const sourceSlots = prev[sourceKey] || [];
      const next = { ...prev };
      targets.forEach(d => { next[d] = [...sourceSlots]; });
      return next;
    });
    setCopySourceDate(null);
    setCopyTargetDates([]);
    setAvailSaved(false);
  };

  // Save all availability for this week to Supabase at once
  const saveAllAvailability = async () => {
    setAvailSaving(true);
    try {
      // Find every date that differs from the last saved snapshot
      const allDirtyKeys = new Set([
        ...Object.keys(availability),
        ...Object.keys(savedAvailability),
      ]);
      for (const dateKey of allDirtyKeys) {
        const current = JSON.stringify(availability[dateKey] || []);
        const saved   = JSON.stringify(savedAvailability[dateKey] || []);
        if (current !== saved) {
          await saveWalkerAvailabilityDay(walker.id, dateKey, availability[dateKey] || []);
        }
      }
      // Snapshot entire availability as the new saved state
      setSavedAvailability(JSON.parse(JSON.stringify(availability)));
      setAvailSaved(true);
      setTimeout(() => setAvailSaved(false), 3000);
    } catch (e) {
      console.error("Save availability failed:", e);
      alert("Save failed. Please check your connection and try again.");
    }
    setAvailSaving(false);
  };

  const inputStyle = {
    padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #e4e7ec",
    background: "#f9fafb", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
    color: "#111827", outline: "none",
  };

  // Background poll — always running so badge stays current on any tab
  useEffect(() => {
    loadChatMessages().then(setChatMessages);
    const bgPoll = setInterval(() => {
      loadChatMessages().then(setChatMessages);
    }, 30000);
    return () => clearInterval(bgPoll);
  }, []);

  // Fast poll + mark-seen only when on the chat tab
  useEffect(() => {
    if (tab === "chat") {
      const now = new Date().toISOString();
      setChatLastSeenAt(now);
      try { localStorage.setItem(`dwi_chat_seen_${walker?.id || 0}`, now); } catch {}
      setChatLoading(true);
      loadChatMessages().then(msgs => { setChatMessages(msgs); setChatLoading(false); });
      chatPollRef.current = setInterval(() => {
        loadChatMessages().then(msgs => setChatMessages(msgs));
      }, 8000);
    } else {
      if (chatPollRef.current) { clearInterval(chatPollRef.current); chatPollRef.current = null; }
    }
    return () => { if (chatPollRef.current) { clearInterval(chatPollRef.current); chatPollRef.current = null; } };
  }, [tab]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = chatContainerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  // DM thread polling — runs while a thread is open on the chat tab
  useEffect(() => {
    if (tab === "chat" && msgSubTab === "direct" && dmThread) {
      setDmLoading(true);
      loadDirectMessages(walker.name, dmThread).then(msgs => {
        setDmMessages(msgs);
        setDmLoading(false);
        // Mark this thread as seen
        const now = new Date().toISOString();
        setDmSeenMap(prev => {
          const next = { ...prev, [dmThread]: now };
          try { localStorage.setItem(`dwi_dm_seen_${walker?.id || 0}`, JSON.stringify(next)); } catch {}
          return next;
        });
      });
      dmPollRef.current = setInterval(() => {
        loadDirectMessages(walker.name, dmThread).then(setDmMessages);
      }, 8000);
    } else {
      if (dmPollRef.current) { clearInterval(dmPollRef.current); dmPollRef.current = null; }
    }
    return () => { if (dmPollRef.current) { clearInterval(dmPollRef.current); dmPollRef.current = null; } };
  }, [tab, msgSubTab, dmThread]);

  // Auto-scroll DM thread
  useEffect(() => {
    const el = dmContainerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      dmBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [dmMessages]);

  const sendDm = async () => {
    if (!dmInput.trim() || !dmThread) return;
    const text = dmInput.trim();
    setDmInput("");
    const tempMsg = { id: `tmp-${Date.now()}`, from: walker.name, text, sentAt: new Date().toISOString(), time: "Just now" };
    setDmMessages(m => [...m, tempMsg]);
    await saveDirectMessage(walker.name, dmThread, text);
    loadDirectMessages(walker.name, dmThread).then(setDmMessages);
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput("");
    // Optimistic update
    const tempMsg = { id: `tmp-${Date.now()}`, from: walker.name, text, sentAt: new Date().toISOString(), time: "Just now" };
    setChatMessages(m => [...m, tempMsg]);
    // Persist to Supabase
    await saveChatMessage(walker.name, text);
    // Refresh to get server-assigned IDs and correct timestamps
    loadChatMessages().then(setChatMessages);
  };

  // Unread badge: messages from others newer than last-seen timestamp
  const unreadChatCount = chatLastSeenAt
    ? chatMessages.filter(m => m.from !== walker.name && m.sentAt && new Date(m.sentAt) > new Date(chatLastSeenAt)).length
    : 0;

  // ── Walker ↔ Client message polling ──────────────────────────────────────────
  // Get all clients whose keyholder is this walker
  const myKeyClients = Object.values(clients).filter(c => !c.deleted && c.keyholder === walker.name);

  const loadAllClientMsgs = () =>
    Promise.all(
      myKeyClients.map(c => loadClientMessages(c.email, walker.name).then(msgs => ({ email: c.email, msgs })))
    ).then(results => {
      const map = {};
      results.forEach(({ email, msgs }) => { map[email] = msgs; });
      setClientMsgsByEmail(map);
    });

  // Background poll: always runs so the badge stays fresh on other tabs
  const clientMsgBgPollRef = useRef(null);
  useEffect(() => {
    if (myKeyClients.length === 0) return;
    loadAllClientMsgs();
    clientMsgBgPollRef.current = setInterval(() => {
      if (tab !== "chat" || msgSubTab !== "clients") loadAllClientMsgs();
    }, 30000);
    return () => { if (clientMsgBgPollRef.current) clearInterval(clientMsgBgPollRef.current); };
  }, []);

  // Active poll: fast refresh only while on the clients sub-tab
  useEffect(() => {
    if (tab === "chat" && msgSubTab === "clients") {
      setClientMsgLoading(true);
      loadAllClientMsgs().then(() => setClientMsgLoading(false));
      clientMsgPollRef.current = setInterval(loadAllClientMsgs, 8000);
    } else {
      if (clientMsgPollRef.current) { clearInterval(clientMsgPollRef.current); clientMsgPollRef.current = null; }
    }
    return () => { if (clientMsgPollRef.current) { clearInterval(clientMsgPollRef.current); clientMsgPollRef.current = null; } };
  }, [tab, msgSubTab]);

  // Mark conversation as seen when walker opens it
  const markClientMsgSeen = (clientEmail) => {
    const now = new Date().toISOString();
    const updated = { ...clientMsgSeenMap, [clientEmail]: now };
    setClientMsgSeenMap(updated);
    try { localStorage.setItem(`dwi_walker_client_msg_seen_${walker.id}`, JSON.stringify(updated)); } catch {}
  };

  useEffect(() => {
    if (selectedClientMsgEmail) markClientMsgSeen(selectedClientMsgEmail);
  }, [selectedClientMsgEmail, clientMsgsByEmail]);

  useEffect(() => {
    const el = clientMsgContainerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      clientMsgBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [clientMsgsByEmail, selectedClientMsgEmail]);

  const sendWalkerMsg = async () => {
    if (!clientMsgInput.trim() || !selectedClientMsgEmail) return;
    const text = clientMsgInput.trim();
    setClientMsgInput("");
    const tempMsg = { id: `tmp-${Date.now()}`, from: walker.name, text, sentAt: new Date().toISOString(), time: "Just now" };
    setClientMsgsByEmail(prev => ({ ...prev, [selectedClientMsgEmail]: [...(prev[selectedClientMsgEmail] || []), tempMsg] }));
    await saveClientMessage(selectedClientMsgEmail, walker.name, walker.name, text);
    notifyAdmin("new_client_message", {
      clientName: Object.values(clients).find(c => c.email === selectedClientMsgEmail)?.name || selectedClientMsgEmail,
      walkerName: walker.name,
      message: text,
    });
    loadClientMessages(selectedClientMsgEmail, walker.name).then(msgs =>
      setClientMsgsByEmail(prev => ({ ...prev, [selectedClientMsgEmail]: msgs }))
    );
  };

  // Unread client messages: messages from client (not walker) newer than last seen per client
  const unreadClientMsgCount = myKeyClients.reduce((total, c) => {
    const msgs = clientMsgsByEmail[c.email] || [];
    const lastSeen = clientMsgSeenMap[c.email] ? new Date(clientMsgSeenMap[c.email]) : null;
    if (!lastSeen) return total + msgs.filter(m => m.from !== walker.name).length;
    return total + msgs.filter(m => m.from !== walker.name && m.sentAt && new Date(m.sentAt) > lastSeen).length;
  }, 0);

  const [walkerSeenTs, setWalkerSeenTs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dwi_walker_seen_${walker.id}`) || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    setWalkerSeenTs(prev => {
      const updated = { ...prev, [`${tab}At`]: new Date().toISOString() };
      localStorage.setItem(`dwi_walker_seen_${walker.id}`, JSON.stringify(updated));
      return updated;
    });
  }, [tab]);

  const walkerSeenAt = id => walkerSeenTs[`${id}At`] ? new Date(walkerSeenTs[`${id}At`]) : null;

  // mywalks: walks newly assigned to me by admin since last viewed
  const mywalksSeen = walkerSeenAt("mywalks");
  const newMywalksBadge = mywalksSeen
    ? myWalksAll.filter(b => !b.isHandoff && b.bookedAt && new Date(b.bookedAt) > mywalksSeen).length
    : 0;

  // available: new unassigned walks posted since last viewed
  const availableSeen = walkerSeenAt("available");
  const newAvailableBadge = availableSeen
    ? availableWalks.filter(b => b.bookedAt && new Date(b.bookedAt) > availableSeen).length
    : 0;

  // payouts: admin-completed walks (earnings updated) since last viewed
  const payoutsSeen = walkerSeenAt("payouts");
  const newPayoutsBadge = payoutsSeen
    ? completedWalks.filter(b => b.adminCompleted && b.completedAt && new Date(b.completedAt) > payoutsSeen).length
    : 0;

  // trades: new offers from other walkers OR my offers that just got accepted/declined
  const tradesSeen = walkerSeenAt("trades");
  const newTradesBadge = tradesSeen
    ? (trades || []).filter(t => {
        if (t.fromWalker !== walker.name) {
          // New offer posted by someone else
          return t.createdAt && new Date(t.createdAt) > tradesSeen;
        }
        // My offer — status changed since I last looked
        return t.acceptedAt && new Date(t.acceptedAt) > tradesSeen;
      }).length
    : 0;

  const walkerNotifCounts = {
    mywalks:    newMywalksBadge,
    available:  newAvailableBadge,
    payouts:    newPayoutsBadge,
    trades:     newTradesBadge,
    chat:       unreadChatCount + unreadClientMsgCount,
  };

  const TABS = [
    { id: "dashboard",   label: "Dashboard",      icon: "📊" },
    { id: "mywalks",     label: "My Schedule",    icon: "📅" },
    { id: "available",   label: "Unclaimed Walks", icon: "📋" },
    { id: "completed",   label: "Completed Walks", icon: "✅" },
    { id: "availability",label: "Availability",    icon: "🗓" },
    { id: "myclients",   label: "My Clients",      icon: "🗝️" },
    { id: "payouts",     label: "Payouts",         icon: "💵" },
    { id: "invoices",    label: "Client Invoices", icon: "🧾" },
    { id: "trades",      label: "Shift Trades",    icon: "🔄" },
    { id: "schedulewalk",label: "Schedule Walk",   icon: "📆" },
    { id: "chat",        label: "Messages",        icon: "💬" },
    { id: "myinfo",      label: "My Info",         icon: "👤" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f0f2f5" }}>
      <style>{GLOBAL_STYLES}</style>

      {/* Unsaved availability changes modal */}
      {pendingNavTab && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ background: "#fff", borderRadius: "18px", padding: "28px 24px",
            maxWidth: "360px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px", textAlign: "center" }}>⚠️</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
              fontSize: "17px", color: "#111827", marginBottom: "8px", textAlign: "center" }}>
              Unsaved Availability Changes
            </div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              color: "#6b7280", lineHeight: "1.6", marginBottom: "22px", textAlign: "center" }}>
              You have changes that haven't been saved yet. If you leave now they'll be lost.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                onClick={async () => {
                  await saveAllAvailability();
                  const dest = pendingNavTab;
                  setPendingNavTab(null);
                  setTab(dest);
                  document.querySelector("[data-scroll-pane]")?.scrollTo({ top: 0, behavior: "instant" });
                }}
                style={{ width: "100%", padding: "13px", borderRadius: "11px", border: "none",
                  background: "#3D6B7A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>
                💾 Save & Continue
              </button>
              <button
                onClick={() => {
                  setSavedAvailability(JSON.parse(JSON.stringify(availability)));
                  const dest = pendingNavTab;
                  setPendingNavTab(null);
                  setTab(dest);
                  document.querySelector("[data-scroll-pane]")?.scrollTo({ top: 0, behavior: "instant" });
                }}
                style={{ width: "100%", padding: "13px", borderRadius: "11px",
                  border: "1.5px solid #fca5a5", background: "#fef2f2",
                  color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
                Discard Changes & Leave
              </button>
              <button
                onClick={() => setPendingNavTab(null)}
                style={{ width: "100%", padding: "11px", borderRadius: "11px",
                  border: "1.5px solid #e4e7ec", background: "#fff",
                  color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", cursor: "pointer" }}>
                Stay on Availability
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header + Nav */}
      <div data-scroll-pane style={{ flex: 1, overflowY: "scroll", WebkitOverflowScrolling: "touch" }}>
      {/* Header */}
      <header style={{ background: "#1A3A42", padding: "16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <LogoBadge size={30} />
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                fontSize: "15px", textTransform: "uppercase", fontWeight: 600, letterSpacing: "1px" }}>Lonestar Bark Co.</div>
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#4E7A8C",
              fontSize: "16px", marginTop: "2px" }}>
              {walker.avatar} {walker.name} · {TABS.find(t => t.id === tab)?.label || ""}
            </div>
          </div>
          <button onClick={() => setWalkerMenuOpen(true)} style={{ background: "transparent",
            border: "1px solid rgba(255,255,255,0.35)", color: "rgba(255,255,255,0.65)", padding: "8px 12px",
            borderRadius: "8px", cursor: "pointer", fontSize: "18px", lineHeight: 1,
            display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
            <span style={{ display: "block", width: "18px", height: "2px", background: "#4E7A8C", borderRadius: "2px" }} />
            <span style={{ display: "block", width: "18px", height: "2px", background: "#4E7A8C", borderRadius: "2px" }} />
            <span style={{ display: "block", width: "18px", height: "2px", background: "#4E7A8C", borderRadius: "2px" }} />
          </button>
        </div>
      </header>
      {/* Sliding Tab Nav — sticky inside scroll pane */}
      <nav style={{ background: "#1A3A42", borderBottom: "1px solid #254E5E",
        display: "flex", alignItems: "stretch",
        position: "sticky", top: 0, zIndex: 10 }}
        className="nav-tabs sticky-nav">
        {/* ── Pinned: My Schedule ── */}
        {(() => {
          const t = TABS[0];
          return (
            <button key={t.id} onClick={() => { changeTab(t.id); document.querySelector('[data-scroll-pane]')?.scrollTo({ top: 0, behavior: 'instant' }); }} style={{
              padding: "10px 14px", border: "none", whiteSpace: "nowrap",
              background: "transparent", flexShrink: 0,
              borderBottom: tab === t.id ? "3px solid #3A849A" : "3px solid transparent",
              borderRight: "1px solid #254E5E",
              color: tab === t.id ? "#fff" : "#4E7A8C",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              fontWeight: tab === t.id ? 600 : 400,
              cursor: "pointer", transition: "color 0.15s, border-color 0.15s",
              display: "flex", alignItems: "center", gap: "5px",
            }}>
              <span style={{ fontSize: "15px" }}>{t.icon}</span> {t.label}
            </button>
          );
        })()}
        {/* ── Scrollable: everything else + logout ── */}
        <div style={{ flex: 1, overflowX: "auto", display: "flex",
          scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {TABS.slice(1).map(t => {
            const badge = walkerNotifCounts[t.id] || 0;
            return (
              <button key={t.id} onClick={() => { changeTab(t.id); document.querySelector('[data-scroll-pane]')?.scrollTo({ top: 0, behavior: 'instant' }); }} style={{
                padding: "10px 14px", border: "none", whiteSpace: "nowrap", background: "transparent",
                borderBottom: tab === t.id ? "3px solid #3A849A" : "3px solid transparent",
                color: tab === t.id ? "#fff" : "rgba(255,255,255,0.65)",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                fontWeight: tab === t.id ? 600 : 400,
                cursor: "pointer", transition: "color 0.15s, border-color 0.15s",
                display: "flex", alignItems: "center", gap: "5px", flexShrink: 0,
              }}>
                <span style={{ fontSize: "15px" }}>{t.icon}</span> {t.label}
                {badge > 0 && (
                  <span style={{ background: "#ef4444", color: "#fff", borderRadius: "10px",
                    fontSize: "16px", fontWeight: 700, padding: "1px 6px", lineHeight: "16px",
                    minWidth: "16px", textAlign: "center", display: "inline-block" }}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <button onClick={onLogout} style={{
            padding: "10px 14px", border: "none", background: "transparent",
            color: "rgba(255,255,255,0.65)", fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
            cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
            borderBottom: "3px solid transparent",
            display: "flex", alignItems: "center", gap: "5px",
          }}>↩ Log out</button>
        </div>
      </nav>

      {/* Hamburger Menu Drawer */}
      {walkerMenuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
          {/* Backdrop */}
          <div onClick={() => setWalkerMenuOpen(false)}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
          {/* Drawer */}
          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "280px",
            background: "#1A3A42", display: "flex", flexDirection: "column",
            boxShadow: "4px 0 24px rgba(0,0,0,0.3)", overflowY: "auto" }}>
            <div style={{ padding: "24px 20px 16px", borderBottom: "1px solid #254E5E",
              display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <LogoBadge size={28} />
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                    fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600 }}>Lonestar Bark Co.</div>
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", marginTop: "2px", color: "rgba(255,255,255,0.65)" }}>{walker.avatar} {walker.name}</div>
              </div>
              <button onClick={() => setWalkerMenuOpen(false)} style={{ background: "none",
                border: "none", color: "rgba(255,255,255,0.65)", fontSize: "22px", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, padding: "12px 0" }}>
              {TABS.map(t => {
                const badge = walkerNotifCounts[t.id] || 0;
                return (
                  <button key={t.id} onClick={() => { changeTab(t.id); setWalkerMenuOpen(false); }} style={{
                    width: "100%", padding: "13px 20px", border: "none",
                    display: "flex", alignItems: "center", gap: "14px", cursor: "pointer",
                    borderLeft: tab === t.id ? "3px solid #3A849A" : "3px solid transparent",
                    background: tab === t.id ? "rgba(74,144,217,0.12)" : "transparent",
                  }}>
                    <span style={{ fontSize: "18px", width: "24px", textAlign: "center" }}>{t.icon}</span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      fontWeight: tab === t.id ? 600 : 400,
                      color: tab === t.id ? "#fff" : "rgba(255,255,255,0.65)", flex: 1 }}>{t.label}</span>
                    {badge > 0 && (
                      <span style={{ background: "#ef4444", color: "#fff", borderRadius: "10px",
                        fontSize: "16px", fontWeight: 700, padding: "1px 6px",
                        minWidth: "16px", textAlign: "center", display: "inline-block" }}>
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: "16px 20px", borderTop: "1px solid #254E5E" }}>
              <button onClick={onLogout} style={{ width: "100%", padding: "11px",
                borderRadius: "10px", border: "1px solid #3D6B7A", background: "transparent",
                color: "#4E7A8C", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                cursor: "pointer" }}>Log out</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px 16px 80px" }}>

        {/* ── Dashboard ── */}
        {tab === "dashboard" && (() => {
          const todayStr = now.toDateString();
          const { monday: wMon, sunday: wSun } = getCurrentWeekRange();

          // Time buckets
          const todayWalks = myWalks.filter(b => new Date(b.scheduledDateTime || b.bookedAt).toDateString() === todayStr);
          const nextWalk   = todayWalks.find(b => new Date(b.scheduledDateTime || b.bookedAt) > now)
                          || myWalks.find(b => new Date(b.scheduledDateTime || b.bookedAt) > now);

          const weekWalks  = myWalksAll.filter(b => {
            const d = new Date(b.scheduledDateTime || b.bookedAt);
            return d >= wMon && d <= wSun;
          });

          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          const monthWalks = myWalksAll.filter(b => {
            const d = new Date(b.scheduledDateTime || b.bookedAt);
            return d >= monthStart && d <= monthEnd;
          });

          // Earnings (completed)
          const weekCompleted  = completedWalks.filter(b => {
            const d = new Date(b.scheduledDateTime || b.bookedAt); return d >= wMon && d <= wSun;
          });
          const monthCompleted = completedWalks.filter(b => {
            const d = new Date(b.scheduledDateTime || b.bookedAt); return d >= monthStart && d <= monthEnd;
          });
          const weekPayout  = weekCompleted.reduce((s, b)  => s + Math.round(getWalkerPayout(b)), 0);
          const monthPayout = monthCompleted.reduce((s, b) => s + Math.round(getWalkerPayout(b)), 0);
          const allTimePayout = Math.round(totalEarned);

          // Invoice KPIs (key clients)
          const myInvoicesAll = myKeyClients.flatMap(c => (c.invoices || []).map(inv => ({ ...inv, clientName: c.name })));
          const outstandingAmt = myInvoicesAll.filter(inv => invoiceStatusMeta(inv.status, inv.dueDate).effectiveStatus === "sent").reduce((s, inv) => s + (inv.total || 0), 0);
          const overdueCount   = myInvoicesAll.filter(inv => invoiceStatusMeta(inv.status, inv.dueDate).effectiveStatus === "overdue").length;
          const overdueAmt     = myInvoicesAll.filter(inv => invoiceStatusMeta(inv.status, inv.dueDate).effectiveStatus === "overdue").reduce((s, inv) => s + (inv.total || 0), 0);

          // Gratuity totals
          const paidInvoices     = myInvoicesAll.filter(inv => inv.status === "paid" && inv.gratuity > 0);
          const allTimeGratuity  = paidInvoices.reduce((s, inv) => s + (inv.gratuity || 0), 0);
          const { monday: wMonG, sunday: wSunG } = getCurrentWeekRange();
          const weekGratuity     = paidInvoices.filter(inv => { const d = new Date(inv.paidAt); return d >= wMonG && d <= wSunG; }).reduce((s, inv) => s + (inv.gratuity || 0), 0);

          // Next 5 upcoming walks across all time
          const upcoming5 = [...myWalks].sort((a, b) =>
            new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt)
          ).slice(0, 5);

          const pill = (label, color, bg) => (
            <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: "20px",
              background: bg, color, fontFamily: "'DM Sans', sans-serif",
              fontSize: "13px", fontWeight: 600 }}>{label}</span>
          );

          const kpiCard = (icon, value, label, color, bg, border, onClick) => (
            <div onClick={onClick} style={{ background: bg, border: `1.5px solid ${border}`,
              borderRadius: "14px", padding: "14px 16px",
              cursor: onClick ? "pointer" : "default",
              display: "flex", flexDirection: "column", gap: "4px",
              transition: "box-shadow 0.15s" }}
              onMouseEnter={e => onClick && (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.10)")}
              onMouseLeave={e => onClick && (e.currentTarget.style.boxShadow = "none")}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px",
                textTransform: "uppercase", letterSpacing: "1px",
                fontWeight: 600, color }}>{label}</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "22px",
                fontWeight: 700, color,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
            </div>
          );

          return (
            <div className="fade-up">
              {/* ── Greeting ── */}
              <div style={{ marginBottom: "24px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "22px",
                  fontWeight: 700, color: "#111827", marginBottom: "4px" }}>
                  Hey, {walker.name.split(" ")[0]} {walker.avatar}
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
                  {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                  {todayWalks.length > 0
                    ? ` · ${todayWalks.length} walk${todayWalks.length !== 1 ? "s" : ""} today`
                    : " · No walks scheduled today"}
                </div>
              </div>

              {/* ── Walk counts KPI grid ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
                {kpiCard("📅", todayWalks.length,  "Walks Today",      "#1A3A42", "#EBF4F6", "#A8D0DB", () => setTab("mywalks"))}
                {kpiCard("📋", weekWalks.length,   "Walks This Week",  accentBlue, "#EBF4F6", "#A8D0DB", () => setTab("mywalks"))}
                {kpiCard("📆", monthWalks.length,  "Walks This Month", accentBlue, "#EBF4F6", "#A8D0DB", () => setTab("mywalks"))}
                {kpiCard("✅", completedWalks.length, "Completed Walks",
                  accentBlue, "#EBF4F6", "#A8D0DB", () => setTab("completed"))}
              </div>

              {/* ── Earnings KPI grid ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
                {kpiCard("💵", fmt(weekPayout, true),    "Week's Earnings",  "#C4541A", "#FDF5EC", "#F0E8D5", () => setTab("payouts"))}
                {kpiCard("💰", fmt(monthPayout, true),   "Month's Earnings", "#C4541A", "#FDF5EC", "#F0E8D5", () => setTab("payouts"))}
                {kpiCard("🏅", fmt(allTimePayout, true), "All-Time Earnings","#C4541A", "#FDF5EC", "#F0E8D5", () => setTab("payouts"))}
                {kpiCard("🗝️", myKeyClients.length, "Key Clients",
                  "#7A4D6E", "#F9F0F7", "#D8ABCF", () => setTab("myclients"))}
              </div>

              {/* ── Gratuity KPI grid ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
                {kpiCard("", weekGratuity > 0 ? fmt(weekGratuity, true) : "—", "This Week's Gratuity",
                  "#059669", "#f0fdf4", "#a8d5bf", null)}
                {kpiCard("", allTimeGratuity > 0 ? fmt(allTimeGratuity, true) : "—", "All-Time Gratuity",
                  "#059669", "#f0fdf4", "#a8d5bf", null)}
              </div>

              {/* ── Outstanding + Overdue ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
                {kpiCard("🧾", outstandingAmt > 0 ? fmt(outstandingAmt, true) : "—", "Outstanding",
                  outstandingAmt > 0 ? "#dc2626" : "#059669",
                  outstandingAmt > 0 ? "#fef2f2" : "#f0fdf4",
                  outstandingAmt > 0 ? "#dc2626" : "#a8d5bf",
                  () => setTab("invoices"))}
                {kpiCard("⚠️", overdueCount > 0 ? `${overdueCount} ($${overdueAmt})` : "None",
                  "Overdue Invoices",
                  overdueCount > 0 ? "#dc2626" : "#059669",
                  overdueCount > 0 ? "#fef2f2" : "#f0fdf4",
                  overdueCount > 0 ? "#dc2626" : "#a8d5bf",
                  () => setTab("invoices"))}
              </div>

              {/* ── Next Walk ── */}
              {nextWalk && (
                <div onClick={() => setTab("mywalks")}
                  style={{ background: accentBlue, borderRadius: "16px", padding: "18px 20px",
                    marginBottom: "20px", cursor: "pointer",
                    boxShadow: "0 4px 20px rgba(61,107,122,0.25)" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                    textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: "6px" }}>
                    Next Walk
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px",
                    fontWeight: 700, color: "#fff", marginBottom: "3px" }}>
                    {nextWalk.clientName} · {nextWalk.form?.pet || "Pet"}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "rgba(255,255,255,0.8)" }}>
                    {nextWalk.day}, {nextWalk.date} at {nextWalk.slot?.time}
                    {" "}· {nextWalk.slot?.duration}
                    {nextWalk.walkerConfirmed
                      ? <span style={{ marginLeft: "8px", background: "rgba(255,255,255,0.2)",
                          borderRadius: "8px", padding: "1px 8px", fontSize: "13px" }}>✓ Confirmed</span>
                      : <span style={{ marginLeft: "8px", background: "rgba(255,255,255,0.2)",
                          borderRadius: "8px", padding: "1px 8px", fontSize: "13px" }}>Tap to confirm</span>}
                  </div>
                </div>
              )}

              {/* ── Upcoming schedule preview ── */}
              <div style={{ background: "#fff", borderRadius: "16px",
                border: "1.5px solid #e4e7ec", padding: "20px", marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center",
                  justifyContent: "space-between", marginBottom: "14px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "#111827" }}>Upcoming Walks</div>
                  <button onClick={() => setTab("mywalks")} style={{ background: "none",
                    border: "none", fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                    color: accentBlue, cursor: "pointer", fontWeight: 500 }}>
                    See all →
                  </button>
                </div>
                {upcoming5.length === 0 ? (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#9ca3af", textAlign: "center", padding: "20px 0" }}>
                    No upcoming walks. Check unclaimed shifts!
                  </div>
                ) : upcoming5.map((b, i) => {
                  const isToday = new Date(b.scheduledDateTime || b.bookedAt).toDateString() === todayStr;
                  return (
                    <div key={b.key || i} style={{ display: "flex", alignItems: "center",
                      gap: "12px", padding: "11px 0",
                      borderBottom: i < upcoming5.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "10px",
                        background: isToday ? `${accentBlue}18` : "#f3f4f6",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "18px", flexShrink: 0 }}>
                        {b.service === "cat" ? "🐱" : "🐕"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: 600, color: "#111827" }}>
                          {b.clientName}
                          {isToday && pill("Today", accentBlue, `${accentBlue}18`)}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                          color: "#6b7280", marginTop: "1px" }}>
                          {b.day}, {b.date} · {b.slot?.time} · {b.slot?.duration}
                        </div>
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 600, color: "#374151", flexShrink: 0 }}>
                        ${Math.round(getWalkerPayout(b))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Alerts ── */}
              {(availableWalks.length > 0 || overdueCount > 0 || unreadClientMsgCount > 0) && (
                <div style={{ background: "#fff", borderRadius: "16px",
                  border: "1.5px solid #e4e7ec", padding: "20px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "#111827", marginBottom: "12px" }}>Needs Attention</div>
                  {[
                    availableWalks.length > 0 && {
                      icon: "📋", color: accentBlue, bg: "#EBF4F6", border: "#A8D0DB",
                      text: `${availableWalks.length} unclaimed walk${availableWalks.length !== 1 ? "s" : ""} available`,
                      tab: "available",
                    },
                    overdueCount > 0 && {
                      icon: "⚠️", color: "#dc2626", bg: "#fef2f2", border: "#fecaca",
                      text: `${overdueCount} overdue invoice${overdueCount !== 1 ? "s" : ""} ($${overdueAmt} outstanding)`,
                      tab: "invoices",
                    },
                    unreadClientMsgCount > 0 && {
                      icon: "💬", color: "#7A4D6E", bg: "#F9F0F7", border: "#D8ABCF",
                      text: `${unreadClientMsgCount} unread client message${unreadClientMsgCount !== 1 ? "s" : ""}`,
                      tab: "chat", onNav: () => setMsgSubTab("clients"),
                    },
                  ].filter(Boolean).map((alert, i) => (
                    <div key={i} onClick={() => { changeTab(alert.tab); if (alert.onNav) alert.onNav(); }}
                      style={{ display: "flex", alignItems: "center", gap: "12px",
                        padding: "11px 14px", borderRadius: "10px",
                        background: alert.bg, border: `1.5px solid ${alert.border}`,
                        marginBottom: "8px", cursor: "pointer" }}>
                      <span style={{ fontSize: "18px" }}>{alert.icon}</span>
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: alert.color, fontWeight: 500, flex: 1 }}>{alert.text}</span>
                      <span style={{ color: alert.color, fontSize: "16px" }}>›</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Unclaimed Walks ── */}
        {tab === "available" && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "6px" }}>Unclaimed Walks</div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
              marginBottom: "20px" }}>
              Unassigned walks open for claiming. Claim one and it moves to your schedule.
            </p>

            {availableWalks.length === 0 && unclaimedHandoffs.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: "16px", padding: "40px",
                textAlign: "center", border: "1.5px solid #e4e7ec" }}>
                <div style={{ fontSize: "32px", marginBottom: "10px" }}>✅</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#6b7280", fontSize: "16px" }}>
                  All walks are currently assigned!
                </div>
              </div>
            ) : (<>

              {/* ── Unclaimed Meet & Greet Appointments ── */}
              {unclaimedHandoffs.length > 0 && (
                <div style={{ marginBottom: "28px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                    letterSpacing: "2px", textTransform: "uppercase", color: "#7A4D6E",
                    marginBottom: "12px" }}>🗝️ New Client Handoffs</div>
                  {unclaimedHandoffs.map((b, i) => {
                    const justClaimed = claimedKeys.has(b.key);
                    return (
                      <div key={b.key} style={{
                        borderRadius: "16px", marginBottom: "12px", overflow: "hidden",
                        border: justClaimed ? "1.5px solid #C4A0B8" : "2px solid #7A4D6E",
                        boxShadow: justClaimed ? "none" : "0 4px 20px rgba(107,63,160,0.12)",
                      }}>
                        {/* Banner */}
                        {!justClaimed && (
                          <div style={{ background: "linear-gradient(135deg, #7A4D6E, #9B6A8E)",
                            padding: "12px 18px", display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontSize: "18px" }}>🗝️</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                                fontSize: "15px", color: "#fff", marginBottom: "1px" }}>
                                Claim this client for yourself!
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                color: "#E8D0E0", lineHeight: "1.4" }}>
                                This is a 15-minute meet-and-greet — no charge. Claim it and you'll
                                become their dedicated walker and keyholder.
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                                color: "#E8D0E0cc", lineHeight: "1.4", marginTop: "6px",
                                borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: "6px" }}>
                                📞 You must call this client prior to their scheduled appointment to confirm your estimated arrival time.
                              </div>
                            </div>
                          </div>
                        )}
                        {/* Card body */}
                        <div style={{ background: justClaimed ? "#F5EFF3" : "#fff", padding: "16px 18px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                  fontSize: "15px", color: "#111827" }}>
                                  Meet & Greet Appointment · 15 min
                                </div>
                                {justClaimed && (
                                  <span style={{ background: "#F5EFF3", border: "1px solid #C4A0B8",
                                    borderRadius: "5px", padding: "1px 7px",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                    fontWeight: 700, color: "#7A4D6E" }}>✓ CLAIMED</span>
                                )}
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                color: "#6b7280", marginBottom: "3px" }}>
                                📅 {b.day}, {b.date} at {b.slot?.time}
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                color: "#6b7280" }}>
                                👤 {b.clientName}
                              </div>
                            </div>
                            <div style={{ flexShrink: 0, textAlign: "right" }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                color: "#9ca3af", fontStyle: "italic", marginBottom: "8px" }}>Free</div>
                              {justClaimed ? (
                                <button onClick={() => setTab("myclients")}
                                  style={{ padding: "8px 14px", borderRadius: "9px", border: "none",
                                    background: "#7A4D6E", color: "#fff",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                    fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                                  View in My Clients →
                                </button>
                              ) : claimingKey === b.key ? null : (
                                <button
                                  onClick={() => { setClaimingKey(b.key); setClaimAcknowledged(false); }}
                                  style={{ padding: "8px 16px", borderRadius: "9px", border: "none",
                                    background: "#7A4D6E", color: "#fff",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                    fontWeight: 600, cursor: "pointer" }}>
                                  Claim Client →
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Claim confirmation */}
                          {claimingKey === b.key && !justClaimed && (
                            <div className="fade-up" style={{
                              borderTop: "1px solid #C4A0B8", marginTop: "14px",
                              paddingTop: "14px",
                            }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                fontSize: "15px", color: "#111827", marginBottom: "6px" }}>
                                Claim {b.clientName} as your client?
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                color: "#6b7280", marginBottom: "12px", lineHeight: "1.55" }}>
                                📅 <strong>{b.day}, {b.date}</strong> at <strong>{b.slot?.time}</strong> · You'll become their walker and keyholder.
                              </div>
                              <div style={{ background: "#F5EFF3", border: "1.5px solid #C4A0B8",
                                borderRadius: "10px", padding: "12px 14px", marginBottom: "14px" }}>
                                <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                                  <input type="checkbox" checked={claimAcknowledged}
                                    onChange={e => setClaimAcknowledged(e.target.checked)}
                                    style={{ marginTop: "2px", width: "16px", height: "16px",
                                      flexShrink: 0, cursor: "pointer", accentColor: "#7A4D6E" }} />
                                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                    color: "#374151", lineHeight: "1.55" }}>
                                    I understand that by claiming this client, I'm committing to attend
                                    their meet & greet appointment and becoming their primary walker and keyholder.
                                    This client will appear in My Clients going forward.
                                  </span>
                                </label>
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button
                                  disabled={!claimAcknowledged}
                                  onClick={() => { claimHandoff(b); setClaimingKey(null); setClaimAcknowledged(false); }}
                                  style={{ flex: 1, padding: "10px", borderRadius: "9px", border: "none",
                                    background: claimAcknowledged ? "#7A4D6E" : "#d1d5db", color: "#fff",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                                    cursor: claimAcknowledged ? "pointer" : "not-allowed",
                                    transition: "background 0.15s" }}>
                                  ✓ Claim This Client
                                </button>
                                <button onClick={() => { setClaimingKey(null); setClaimAcknowledged(false); }}
                                  style={{ padding: "10px 16px", borderRadius: "9px",
                                    border: "1.5px solid #e4e7ec", background: "#fff",
                                    color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "15px", cursor: "pointer" }}>Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Regular unclaimed walks ── */}
              {availableWalks.length > 0 && (
                <div>
                  {availableWalks.length > 0 && unclaimedHandoffs.length > 0 && (
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                      letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af",
                      marginBottom: "12px" }}>Unassigned Walks</div>
                  )}
                  {availableWalks.map((b, i) => {
              const justClaimed = claimedKeys.has(b.key);
              return (
                <div key={b.key || i} style={{
                  background: justClaimed ? "#FDF5EC" : "#fff",
                  border: justClaimed ? "1.5px solid #EDD5A8" : "1.5px solid #e4e7ec",
                  borderRadius: "16px", padding: "18px 20px", marginBottom: "12px",
                  transition: "all 0.2s ease",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "15px", color: "#111827" }}>
                          {b.form?.pet || "Pet"} · {b.slot?.duration || "30 min"}
                        </div>
                        {justClaimed && (
                          <span style={{ background: "#FDF5EC", border: "1px solid #EDD5A8",
                            borderRadius: "5px", padding: "1px 7px",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#059669" }}>✓ CLAIMED</span>
                        )}
                        {b.isRecurring && (
                          <span style={{ background: "#EBF4F6", border: "1px solid #8ECAD4",
                            borderRadius: "5px", padding: "1px 7px",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#2A7A90" }}>🔁 RECURRING</span>
                        )}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        color: "#6b7280", marginBottom: "3px" }}>
                        📅 {b.day}, {b.date} at {b.slot?.time}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                        👤 {b.clientName} &nbsp;·&nbsp; 📍 {b.clientAddress || "Address on file"}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                        fontWeight: 600, color: justClaimed ? "#059669" : accentBlue, marginBottom: "8px" }}>
                        ${Math.round(getWalkerPayout(b))}
                      </div>
                      {justClaimed ? (
                        <button
                          onClick={() => setTab("mywalks")}
                          style={{
                            padding: "8px 14px", borderRadius: "9px", border: "none",
                            background: "#059669", color: "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                          }}>
                          View in Schedule →
                        </button>
                      ) : claimingKey === b.key ? null : (
                        <button
                          onClick={() => { setClaimingKey(b.key); setClaimAcknowledged(false); }}
                          style={{
                            padding: "8px 16px", borderRadius: "9px", border: "none",
                            background: accentBlue, color: "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, cursor: "pointer",
                          }}>
                          Claim Walk →
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Claim confirmation dialog */}
                  {claimingKey === b.key && !justClaimed && (
                    <div className="fade-up" style={{
                      borderTop: `1px solid ${accentBlue}22`,
                      background: "#EBF4F6",
                      padding: "16px 18px",
                    }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                        fontSize: "15px", color: "#111827", marginBottom: "6px" }}>
                        Claim this walk?
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        color: "#6b7280", marginBottom: "12px", lineHeight: "1.55" }}>
                        📅 <strong>{b.day}, {b.date}</strong> at <strong>{b.slot?.time}</strong> · {b.slot?.duration} · {b.clientName}
                      </div>
                      <div style={{ background: "#fff", border: `1.5px solid ${accentBlue}33`,
                        borderRadius: "10px", padding: "12px 14px", marginBottom: "14px" }}>
                        <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={claimAcknowledged}
                            onChange={e => setClaimAcknowledged(e.target.checked)}
                            style={{ marginTop: "2px", width: "16px", height: "16px",
                              flexShrink: 0, cursor: "pointer", accentColor: accentBlue }}
                          />
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#374151", lineHeight: "1.55" }}>
                            I understand that once I claim this walk, it becomes part of my committed schedule.
                            If I can no longer complete it, I must arrange a <strong>Shift Trade</strong> with
                            another walker — I cannot simply drop the walk.
                          </span>
                        </label>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          disabled={!claimAcknowledged}
                          onClick={() => {
                            claimWalk(b);
                            setClaimingKey(null);
                            setClaimAcknowledged(false);
                          }}
                          style={{
                            flex: 1, padding: "10px", borderRadius: "9px", border: "none",
                            background: claimAcknowledged ? accentBlue : "#d1d5db",
                            color: "#fff", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", fontWeight: 600,
                            cursor: claimAcknowledged ? "pointer" : "not-allowed",
                            transition: "background 0.15s",
                          }}>
                          ✓ Confirm Claim
                        </button>
                        <button
                          onClick={() => { setClaimingKey(null); setClaimAcknowledged(false); }}
                          style={{
                            padding: "10px 16px", borderRadius: "9px",
                            border: "1.5px solid #e4e7ec", background: "#fff",
                            color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", cursor: "pointer",
                          }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
                </div>
              )}
            </>)}
          </div>
        )}

        {/* ── My Schedule ── */}
        {tab === "mywalks" && (() => {
          const todayStr = new Date().toDateString();
          const walksQ = walkerWalksSearch.toLowerCase();
          const filteredWalks = walksQ
            ? myWalks.filter(b =>
                (b.clientName || "").toLowerCase().includes(walksQ) ||
                (b.form?.pet || "").toLowerCase().includes(walksQ) ||
                (b.day || "").toLowerCase().includes(walksQ) ||
                (b.date || "").toLowerCase().includes(walksQ) ||
                (b.slot?.time || "").toLowerCase().includes(walksQ) ||
                (b.slot?.duration || "").toLowerCase().includes(walksQ)
              )
            : myWalks;

          const todayWalks = filteredWalks.filter(b => {
            const appt = new Date(b.scheduledDateTime || b.bookedAt);
            return appt.toDateString() === todayStr;
          }).sort((a, b) => new Date(a.scheduledDateTime) - new Date(b.scheduledDateTime));

          const futureWalks = filteredWalks.filter(b => {
            const appt = new Date(b.scheduledDateTime || b.bookedAt);
            return appt.toDateString() !== todayStr;
          }).sort((a, b) => new Date(a.scheduledDateTime) - new Date(b.scheduledDateTime));

          const todayConfirmed = todayWalks.filter(b => b.walkerConfirmed).length;
          const allTodayConfirmed = todayWalks.length > 0 && todayConfirmed === todayWalks.length;
          const allWalksPassed = todayWalks.length > 0 && todayWalks.every(b =>
            new Date(b.scheduledDateTime || b.bookedAt) <= new Date()
          );
          const allTodayDone = todayWalks.length > 0 && todayWalks.every(b => b.walkerMarkedComplete);

          const confirmAllToday = () => {
            if (!setClients) return;
            const updated = { ...clients };
            const confirmedWalks = [];
            Object.keys(updated).forEach(cid => {
              const c = updated[cid];
              const newBookings = (c.bookings || []).map(bk => {
                if (bk.cancelled || bk.walkerConfirmed) return bk;
                const appt = new Date(bk.scheduledDateTime || bk.bookedAt);
                if (appt.toDateString() === todayStr && bk.form?.walker === walker.name) {
                  confirmedWalks.push({ clientName: c.name, pet: bk.form?.pet, time: bk.slot?.time });
                  return { ...bk, walkerConfirmed: true, walkerConfirmedAt: new Date().toISOString() };
                }
                return bk;
              });
              updated[cid] = { ...c, bookings: newBookings };
            });
            setClients(updated);
            saveClients(updated);
            if (confirmedWalks.length > 0) {
              notifyAdmin("walk_confirmed", {
                walkerName: walker.name,
                count: confirmedWalks.length,
                walks: confirmedWalks.map(w => `${w.clientName} (${w.pet}) @ ${w.time}`).join(", "),
                confirmedAll: true,
              });
            }
          };

          const confirmSingle = (targetBooking) => {
            if (!setClients) return;
            const cid = targetBooking.clientId || Object.keys(clients).find(id =>
              (clients[id].bookings || []).some(bk => bk.key === targetBooking.key)
            );
            if (!cid) return;
            const updatedClients = {
              ...clients,
              [cid]: {
                ...clients[cid],
                bookings: (clients[cid].bookings || []).map(bk =>
                  bk.key === targetBooking.key
                    ? { ...bk, walkerConfirmed: true, walkerConfirmedAt: new Date().toISOString() }
                    : bk
                ),
              },
            };
            setClients(updatedClients);
            saveClients(updatedClients);
            notifyAdmin("walk_confirmed", {
              walkerName: walker.name,
              count: 1,
              walks: `${targetBooking.clientName} (${targetBooking.form?.pet || "Pet"}) @ ${targetBooking.slot?.time || ""}`,
              confirmedAll: false,
            });
          };

          // Render a single walk card — clickable to expand detail + complete
          const renderWalkCard = (b, showConfirmBtn) => {
            // ── Meet & Greet appointment card ──────────────────────────────────────
            if (b.isHandoff) {
              const purple = "#7A4D6E";
              const isConfirmingHandoff = completingWalkKey === b.key;
              const markHandoffDone = () => {
                const cid = b.clientId;
                if (!cid || !clients[cid]) return;
                const updatedClients = {
                  ...clients,
                  [cid]: { ...clients[cid], handoffConfirmed: true },
                };
                setClients(updatedClients);
                saveClients(updatedClients);
                setCompletingWalkKey(null);
              };
              return (
                <div key={b.key} style={{ background: "#fff", border: `1.5px solid ${purple}33`,
                  borderRadius: "16px", marginBottom: "10px", overflow: "hidden" }}>
                  <div style={{ padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <div style={{ width: "44px", height: "44px", borderRadius: "12px",
                        background: "#F5EFF3", display: "flex", alignItems: "center",
                        justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>🤝</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "16px", color: "#111827", marginBottom: "2px" }}>
                          Meet & Greet — {b.clientName}
                          <span style={{ marginLeft: "8px", fontSize: "16px", background: "#F5EFF3",
                            color: purple, border: `1px solid ${purple}44`,
                            borderRadius: "5px", padding: "1px 6px",
                            fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>NEW CLIENT</span>
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                          {b.day}, {b.date} at {b.slot?.time} · 30 min
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#9ca3af", marginTop: "2px" }}>
                          Meet the client, get to know their pet, collect the spare key
                        </div>
                      </div>
                    </div>

                    {/* Meet & Greet complete button */}
                    <div style={{ marginTop: "12px" }}>
                      {isConfirmingHandoff ? (
                        <div className="fade-up">
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#374151", marginBottom: "10px", fontWeight: 500 }}>
                            Mark this meet & greet as complete?
                          </div>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button onClick={markHandoffDone}
                              style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "none",
                                background: purple, color: "#fff",
                                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 600, cursor: "pointer" }}>
                              ✓ Yes, Meet & Greet Complete
                            </button>
                            <button onClick={() => setCompletingWalkKey(null)}
                              style={{ padding: "10px 16px", borderRadius: "10px",
                                border: "1.5px solid #e4e7ec", background: "#fff",
                                color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", cursor: "pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setCompletingWalkKey(b.key)}
                          style={{ width: "100%", padding: "10px", borderRadius: "10px",
                            border: `1.5px solid ${purple}44`, background: "#F5EFF3",
                            color: purple, fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
                          🤝 Mark Meet & Greet Complete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            const isExpanded   = expandedWalkKey === b.key;
            const isConfirming = completingWalkKey === b.key;
            const confirmed    = b.walkerConfirmed;

            // Full client record for details
            const clientId = b.clientId || Object.keys(clients).find(cid =>
              (clients[cid].bookings || []).some(bk => bk.key === b.key)
            );
            const clientRecord = clientId ? clients[clientId] : null;
            const dogs = clientRecord ? (clientRecord.dogs || clientRecord.pets || []) : [];
            const cats = clientRecord ? (clientRecord.cats || []) : [];
            const allPets = [...dogs, ...cats];

            return (
              <div key={b.key} style={{
                background: "#fff",
                border: isExpanded
                  ? `2px solid ${accentBlue}`
                  : confirmed
                    ? "1.5px solid #EDD5A8"
                    : `1.5px solid ${accentBlue}22`,
                borderRadius: "16px", marginBottom: "10px", overflow: "hidden",
                boxShadow: isExpanded ? `0 4px 18px ${accentBlue}18` : "none",
                transition: "all 0.15s",
              }}>

                {/* ── Card header row (always visible) ── */}
                <div style={{ padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    {/* Left icon — tap to expand */}
                    <button
                      onClick={() => setExpandedWalkKey(isExpanded ? null : b.key)}
                      style={{ width: "44px", height: "44px", borderRadius: "12px",
                        background: confirmed ? "#FDF5EC" : `${accentBlue}12`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "20px", flexShrink: 0, border: "none", cursor: "pointer",
                        padding: 0 }}>
                      {confirmed ? "✅" : "🐕"}
                    </button>

                    {/* Middle info — tap to expand */}
                    <button
                      onClick={() => setExpandedWalkKey(isExpanded ? null : b.key)}
                      style={{ flex: 1, minWidth: 0, background: "none", border: "none",
                        cursor: "pointer", textAlign: "left", padding: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px",
                        flexWrap: "wrap", marginBottom: "3px" }}>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "16px", color: "#111827" }}>
                          {b.form?.pet || "Pet"}
                        </span>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#9ca3af", fontWeight: 400 }}>({b.clientName})</span>
                        {clientRecord?.keyholder === walker.name && (
                          <span title="You hold the key for this client" style={{
                            fontSize: "16px", lineHeight: 1, cursor: "default" }}>🗝️</span>
                        )}
                        {confirmed && (
                          <span style={{ background: "#FDF5EC", border: "1px solid #EDD5A8",
                            borderRadius: "5px", padding: "1px 7px",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#059669" }}>✓ CONFIRMED</span>
                        )}
                        {b.isRecurring && (
                          <span style={{ background: "#EBF4F6", border: "1px solid #8ECAD4",
                            borderRadius: "5px", padding: "1px 7px",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#2A7A90" }}>🔁</span>
                        )}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                        {b.day && b.date ? `${b.day}, ${b.date} · ` : ""}{b.slot?.time} · {b.slot?.duration}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", marginTop: "1px" }}>
                        📍 {b.form?.address || b.clientAddress || "Address on file"}
                      </div>
                    </button>

                    {/* Right column: payout + action buttons */}
                    <div style={{ flexShrink: 0, textAlign: "right", display: "flex",
                      flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                        fontWeight: 600, color: confirmed ? "#059669" : accentBlue }}>
                        ${Math.round(getWalkerPayout(b))}
                      </div>
                      {b.walkerMarkedComplete ? (
                        /* Already marked complete */
                        <span style={{ background: "#FDF5EC", border: "1px solid #EDD5A8",
                          borderRadius: "7px", padding: "4px 10px",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: 700, color: "#059669" }}>✅ Done</span>
                      ) : showConfirmBtn && !confirmed ? (
                        /* Today — not yet confirmed: show Confirm button */
                        <button
                          onClick={e => { e.stopPropagation(); confirmSingle(b); }}
                          style={{ padding: "6px 14px", borderRadius: "8px", border: "none",
                            background: "#059669", color: "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                          }}>✓ Confirm</button>
                      ) : showConfirmBtn ? (
                        /* Today — confirmed: show Mark Done button */
                        <button
                          onClick={e => { e.stopPropagation(); setCompletingWalkKey(isConfirming ? null : b.key); setEarlyAckKey(null); }}
                          style={{ padding: "6px 14px", borderRadius: "8px", border: "none",
                            background: isConfirming ? "#f3f4f6" : "#059669",
                            color: isConfirming ? "#6b7280" : "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                          }}>{isConfirming ? "✕ Cancel" : "✓ Done"}</button>
                      ) : (
                        /* Future walk — just show expand chevron */
                        <button
                          onClick={() => setExpandedWalkKey(isExpanded ? null : b.key)}
                          data-tooltip={isExpanded ? "Collapse" : "View details"}
                          style={{ background: "none", border: "none", cursor: "pointer",
                            padding: 0, fontSize: "15px",
                            color: isExpanded ? accentBlue : "#d1d5db",
                            transform: isExpanded ? "rotate(180deg)" : "none",
                            transition: "transform 0.2s, color 0.2s" }}>⌄</button>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Inline confirm strip (shows without expanding the card) ── */}
                {isConfirming && !isExpanded && (() => {
                  const isFuture = b.scheduledDateTime && new Date(b.scheduledDateTime) > new Date();
                  const ackChecked = earlyAckKey === b.key;
                  const canConfirm = !isFuture || ackChecked;
                  return (
                    <div className="fade-up" style={{ borderTop: `1px solid ${accentBlue}18`,
                      background: "#EBF4F6", padding: "14px 18px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 600, color: "#111827", marginBottom: "10px" }}>
                        Mark this walk as completed?
                      </div>
                      {isFuture && (
                        <div style={{ background: "#fef3c7", border: "1.5px solid #fde68a",
                          borderRadius: "10px", padding: "11px 13px", marginBottom: "10px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#92400e", marginBottom: "8px" }}>
                            ⚠️ Walk hasn't started yet — are you sure it's done?
                          </div>
                          <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                            <input type="checkbox" checked={ackChecked}
                              onChange={e => setEarlyAckKey(e.target.checked ? b.key : null)}
                              style={{ width: "17px", height: "17px", cursor: "pointer", accentColor: "#b45309" }} />
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: "#92400e", fontWeight: 500 }}>
                              Yes, this walk is completed early
                            </span>
                          </label>
                        </div>
                      )}
                      {!isFuture && (
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#6b7280", marginBottom: "10px" }}>
                          This notifies the admin and counts toward your earnings.
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={() => { markWalkCompleted(b); setEarlyAckKey(null); }}
                          disabled={!canConfirm}
                          style={{ flex: 1, padding: "10px", borderRadius: "9px", border: "none",
                            background: canConfirm ? "#059669" : "#d1d5db", color: "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 600, cursor: canConfirm ? "pointer" : "not-allowed" }}>
                          ✓ Yes, Complete Walk
                        </button>
                        <button onClick={() => { setCompletingWalkKey(null); setEarlyAckKey(null); }}
                          style={{ padding: "10px 14px", borderRadius: "9px",
                            border: "1.5px solid #e4e7ec", background: "#fff",
                            color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Expanded detail panel ── */}
                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${accentBlue}18`,
                    background: "#EBF4F6", padding: "16px 18px" }}>

                    {/* ── Mark as Completed — at top for easy access ── */}
                    <div style={{ marginBottom: "16px" }}>
                      {!isConfirming ? (
                        <button onClick={() => { setCompletingWalkKey(b.key); setEarlyAckKey(null); }}
                          style={{
                            width: "100%", padding: "11px 16px", borderRadius: "10px",
                            border: "none", background: "#059669", color: "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px",
                          }}>✓ Mark as Completed</button>
                      ) : (() => {
                        const isFuture = b.scheduledDateTime && new Date(b.scheduledDateTime) > new Date();
                        const ackChecked = earlyAckKey === b.key;
                        const canConfirm = !isFuture || ackChecked;
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 600, color: "#111827" }}>
                              Confirm walk completed?
                            </div>
                            {isFuture && (
                              <div style={{ background: "#fef3c7", border: "1.5px solid #fde68a",
                                borderRadius: "10px", padding: "12px 14px" }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                  fontWeight: 700, color: "#92400e", marginBottom: "8px" }}>
                                  ⚠️ This walk's scheduled time has not yet passed. Are you sure this walk is completed?
                                </div>
                                <label style={{ display: "flex", alignItems: "center", gap: "10px",
                                  cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={ackChecked}
                                    onChange={e => setEarlyAckKey(e.target.checked ? b.key : null)}
                                    style={{ width: "17px", height: "17px", cursor: "pointer", accentColor: "#b45309" }}
                                  />
                                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                    color: "#92400e", fontWeight: 500 }}>
                                    Yes, I confirm this walk has been completed early
                                  </span>
                                </label>
                              </div>
                            )}
                            {!isFuture && (
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                color: "#6b7280" }}>
                                This marks the walk as done and notifies the admin. Revenue will be counted.
                              </div>
                            )}
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button onClick={() => { markWalkCompleted(b); setEarlyAckKey(null); }}
                                disabled={!canConfirm}
                                style={{
                                  flex: 1, padding: "10px", borderRadius: "9px", border: "none",
                                  background: canConfirm ? "#059669" : "#d1d5db",
                                  color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  fontWeight: 600, cursor: canConfirm ? "pointer" : "not-allowed",
                                }}>✓ Yes, Complete Walk</button>
                              <button onClick={() => { setCompletingWalkKey(null); setEarlyAckKey(null); }} style={{
                                padding: "10px 14px", borderRadius: "9px",
                                border: "1.5px solid #e4e7ec", background: "#fff",
                                color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", cursor: "pointer",
                              }}>Cancel</button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Customer details */}
                    <div style={{ marginBottom: "14px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                        fontSize: "16px", letterSpacing: "1.5px", textTransform: "uppercase",
                        color: "#9ca3af", marginBottom: "10px" }}>Customer Details</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                        {[
                          { icon: "👤", label: "Name",    val: b.form?.name || b.clientName },
                          { icon: "📧", label: "Email",   val: b.form?.email || b.clientEmail },
                          { icon: "📞", label: "Phone",   val: b.form?.phone || clientRecord?.phone },
                          { icon: "📍", label: "Address", val: b.form?.address || b.clientAddress || clientRecord?.address },
                        ].map(({ icon, label, val }) => val ? (
                          <div key={label} style={{ background: "#fff", border: "1px solid #e4e7ec",
                            borderRadius: "9px", padding: "9px 12px" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: "#9ca3af", marginBottom: "2px" }}>{icon} {label}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 500, color: "#111827", wordBreak: "break-word" }}>{val}</div>
                          </div>
                        ) : null)}
                      </div>

                      {/* Pets */}
                      {allPets.length > 0 && (
                        <div style={{ marginTop: "8px", background: "#fff",
                          border: "1px solid #e4e7ec", borderRadius: "9px", padding: "9px 12px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#9ca3af", marginBottom: "6px" }}>🐾 Pets on account</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {dogs.map((d, i) => (
                              <span key={i} style={{ background: "#FDF5EC", border: "1px solid #EDD5A8",
                                borderRadius: "6px", padding: "3px 9px",
                                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 500, color: "#059669" }}>🐕 {d}</span>
                            ))}
                            {cats.map((c, i) => (
                              <span key={i} style={{ background: "#EBF4F6", border: "1px solid #8ECAD4",
                                borderRadius: "6px", padding: "3px 9px",
                                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 500, color: "#3D6B7A" }}>🐈 {c}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Notes */}
                      {(b.form?.notes || clientRecord?.notes) && (
                        <div style={{ marginTop: "8px", background: "#fffbeb",
                          border: "1px solid #fde68a", borderRadius: "9px", padding: "9px 12px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#92400e", marginBottom: "3px" }}>📝 Notes</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#374151" }}>{b.form?.notes || clientRecord?.notes}</div>
                        </div>
                      )}
                    </div>

                    {/* Action row — Confirm Walk only (Mark as Completed moved to top) */}
                    {showConfirmBtn && (
                      <div style={{ display: "flex", gap: "8px" }}>
                        {confirmed ? (
                          <div style={{ padding: "9px 14px", borderRadius: "9px",
                            background: "#FDF5EC", border: "1px solid #EDD5A8",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, color: "#059669" }}>✓ Walk Confirmed</div>
                        ) : (
                          <button onClick={() => confirmSingle(b)} style={{
                            padding: "9px 16px", borderRadius: "9px", border: "none",
                            background: "#3D6B7A", color: "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, cursor: "pointer",
                          }}>✓ Confirm Walk</button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          };

          return (
            <div className="fade-up">
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#111827", marginBottom: "6px" }}>My Schedule</div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
                marginBottom: "14px" }}>
                Confirm or mark today's walks complete directly from the list. Tap a walk for full details.
              </p>

              {/* Search bar */}
              <div style={{ position: "relative", marginBottom: "20px" }}>
                <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)",
                  fontSize: "16px", pointerEvents: "none" }}>🔍</span>
                <input
                  value={walkerWalksSearch}
                  onChange={e => setWalkerWalksSearch(e.target.value)}
                  placeholder="Search by client, pet, day, time…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px",
                    borderRadius: "10px", border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", color: "#111827", background: "#fff", outline: "none" }}
                />
                {walkerWalksSearch && (
                  <button onClick={() => setWalkerWalksSearch("")} style={{ position: "absolute", right: "10px",
                    top: "50%", transform: "translateY(-50%)", background: "none", border: "none",
                    cursor: "pointer", color: "#9ca3af", fontSize: "16px" }}>✕</button>
                )}
              </div>

              {myWalks.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: "16px", padding: "40px",
                  textAlign: "center", border: "1.5px solid #e4e7ec" }}>
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>🦺</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#6b7280", fontSize: "16px" }}>
                    No upcoming walks assigned yet.
                  </div>
                </div>
              ) : (
                <>
                  {/* Today's Walks */}
                  {todayWalks.length > 0 && (
                    <div style={{ marginBottom: "28px" }}>
                      <div style={{
                        background: allTodayConfirmed
                          ? "linear-gradient(135deg, #FDF5EC, #FDE8CC)"
                          : "linear-gradient(135deg, #6B3A18, #7A4A25)",
                        border: allTodayConfirmed ? "1.5px solid #EDD5A8" : `1.5px solid ${accentBlue}55`,
                        borderRadius: "16px", padding: "18px 20px", marginBottom: "14px",
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          <div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif",
                              fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
                              color: allTodayConfirmed ? "#059669" : "#fff", marginBottom: "3px" }}>
                              {allTodayConfirmed ? "✅ All confirmed!" : "Today's Walks"}
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: allTodayConfirmed ? "#059669" : "#C4A07A" }}>
                              {todayConfirmed} of {todayWalks.length} confirmed
                            </div>
                            <div style={{ marginTop: "10px", height: "5px", borderRadius: "99px",
                              background: allTodayConfirmed ? "#F0E8D5" : "rgba(255,255,255,0.15)",
                              overflow: "hidden" }}>
                              <div style={{
                                height: "100%", borderRadius: "99px",
                                background: allTodayConfirmed ? "#059669" : "#4ade80",
                                width: `${todayWalks.length > 0 ? (todayConfirmed / todayWalks.length) * 100 : 0}%`,
                                transition: "width 0.4s ease",
                              }} />
                            </div>
                          </div>
                          {!allTodayConfirmed && (
                            <button onClick={confirmAllToday} style={{
                              padding: "11px 20px", borderRadius: "10px", border: "none",
                              background: "#059669", color: "#fff",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 700, cursor: "pointer",
                              boxShadow: "0 4px 14px rgba(5,150,105,0.35)",
                              alignSelf: "flex-start",
                            }}>✓ Confirm Today's Walks</button>
                          )}
                          {/* Mark All as Completed — only shown when every walk's time has passed */}
                          {allWalksPassed && !allTodayDone && (
                            confirmMarkAll ? (
                              <div className="fade-up" style={{ background: "rgba(255,255,255,0.08)",
                                borderRadius: "12px", padding: "14px 16px" }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  fontWeight: 600, color: "#fff", marginBottom: "10px" }}>
                                  Mark all {todayWalks.filter(b => !b.walkerMarkedComplete).length} remaining walk{todayWalks.filter(b => !b.walkerMarkedComplete).length !== 1 ? "s" : ""} as completed?
                                </div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: "#C4A07A", marginBottom: "12px" }}>
                                  This notifies the admin and counts toward your earnings.
                                </div>
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <button onClick={() => { markAllTodayCompleted(todayWalks); setConfirmMarkAll(false); }}
                                    style={{ flex: 1, padding: "10px", borderRadius: "9px", border: "none",
                                      background: "#059669", color: "#fff",
                                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                      fontWeight: 700, cursor: "pointer" }}>
                                    ✓ Yes, Mark All Done
                                  </button>
                                  <button onClick={() => setConfirmMarkAll(false)}
                                    style={{ padding: "10px 16px", borderRadius: "9px",
                                      border: "1.5px solid rgba(255,255,255,0.2)", background: "transparent",
                                      color: "#fff", fontFamily: "'DM Sans', sans-serif",
                                      fontSize: "15px", cursor: "pointer" }}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmMarkAll(true)} style={{
                                padding: "11px 20px", borderRadius: "10px",
                                border: "1.5px solid rgba(255,255,255,0.25)", background: "transparent",
                                color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 700, cursor: "pointer", alignSelf: "flex-start",
                              }}>☑️ Mark All as Completed</button>
                            )
                          )}
                          {allTodayDone && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 600, color: "#059669" }}>
                              ✅ All walks completed!
                            </div>
                          )}
                        </div>
                      </div>
                      {todayWalks.map(b => renderWalkCard(b, true))}
                    </div>
                  )}

                  {/* Upcoming walks */}
                  {futureWalks.length > 0 && (
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                        fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                        color: "#9ca3af", marginBottom: "12px" }}>
                        Upcoming — {futureWalks.length} walk{futureWalks.length !== 1 ? "s" : ""}
                      </div>
                      {futureWalks.map(b => renderWalkCard(b, false))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* ── Completed Walks ── */}
        {tab === "completed" && (() => {
          // Group completed walks by client name
          const byClient = {};
          completedWalks.forEach(b => {
            const name = b.clientName || "Unknown Client";
            if (!byClient[name]) byClient[name] = { walks: [], clientId: b.clientId };
            byClient[name].walks.push(b);
          });

          // Sort each client's walks newest first
          Object.values(byClient).forEach(entry => {
            entry.walks.sort((a, b) => new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) - new Date(a.completedAt || a.scheduledDateTime || a.bookedAt));
          });

          // Sort clients by total revenue descending
          const sortedClients = Object.entries(byClient).sort((a, b) => {
            const aTotal = a[1].walks.reduce((s, w) => s + effectivePrice(w), 0);
            const bTotal = b[1].walks.reduce((s, w) => s + effectivePrice(w), 0);
            return bTotal - aTotal;
          });

          const totalAllTime = completedWalks.reduce((s, b) => s + Math.round(getWalkerPayout(b)), 0);

          return (
            <div className="fade-up">
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Completed Walks</div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
                marginBottom: "20px" }}>
                {completedWalks.length} walk{completedWalks.length !== 1 ? "s" : ""} completed · ${totalAllTime.toLocaleString()} earned all time
              </p>

              {completedWalks.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: "16px", padding: "48px 24px",
                  textAlign: "center", border: "1.5px solid #e4e7ec" }}>
                  <div style={{ fontSize: "36px", marginBottom: "12px" }}>🏅</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                    No completed walks yet.
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#d1d5db", marginTop: "6px" }}>
                    Completed walks will appear here once you mark them done.
                  </div>
                </div>
              ) : sortedClients.map(([clientName, { walks }]) => {
                const clientTotal = walks.reduce((s, w) => s + Math.round(getWalkerPayout(w)), 0);
                const clientGross = walks.reduce((s, w) => s + effectivePrice(w), 0);
                const isOpen = expandedWalkKey === `client_${clientName}`;
                return (
                  <div key={clientName} style={{
                    background: "#fff", border: "1.5px solid #e4e7ec",
                    borderRadius: "16px", marginBottom: "10px", overflow: "hidden",
                  }}>
                    {/* Client header — click to expand */}
                    <button
                      onClick={() => setExpandedWalkKey(isOpen ? null : `client_${clientName}`)}
                      style={{ width: "100%", background: "none", border: "none",
                        padding: "16px 18px", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <div style={{ width: "42px", height: "42px", borderRadius: "12px",
                          background: `${accentBlue}12`, display: "flex", alignItems: "center",
                          justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>🐾</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                            fontSize: "16px", color: "#111827", marginBottom: "2px" }}>
                            {clientName}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#9ca3af" }}>
                            {walks.length} walk{walks.length !== 1 ? "s" : ""} · ${clientGross} billed
                          </div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: "right" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                            fontWeight: 600, color: "#C4541A" }}>
                            ${clientTotal}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#9ca3af" }}>your earnings</div>
                        </div>
                        <div style={{ fontSize: "16px", color: isOpen ? accentBlue : "#d1d5db",
                          transform: isOpen ? "rotate(180deg)" : "none",
                          transition: "transform 0.2s, color 0.2s", flexShrink: 0 }}>⌄</div>
                      </div>
                    </button>

                    {/* Walk list — expanded */}
                    {isOpen && (
                      <div style={{ borderTop: "1px solid #f3f4f6" }}>
                        {walks.map((w, i) => {
                          const completedDate = w.completedAt
                            ? new Date(w.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : w.date || "—";
                          const payout = Math.round(getWalkerPayout(w));
                          return (
                            <div key={w.key || i} style={{
                              display: "flex", alignItems: "center", gap: "12px",
                              padding: "12px 18px",
                              borderBottom: i < walks.length - 1 ? "1px solid #f9fafb" : "none",
                              background: i % 2 === 0 ? "#fafafa" : "#fff",
                            }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
                                  fontSize: "15px", color: "#111827" }}>
                                  {w.form?.pet || "Pet"} · {w.slot?.duration || "30 min"}
                                </div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: "#9ca3af", marginTop: "2px" }}>
                                  {w.day ? `${w.day}, ` : ""}{w.date || ""}
                                  {w.slot?.time ? ` at ${w.slot.time}` : ""}
                                </div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                  color: "#d1d5db", marginTop: "2px" }}>
                                  Completed {completedDate}
                                  {w.walkerMarkedComplete && <span style={{ color: "#059669", marginLeft: "6px" }}>· marked by you</span>}
                                </div>
                              </div>
                              <div style={{ flexShrink: 0, display: "flex", flexDirection: "column",
                                alignItems: "flex-end", gap: "5px" }}>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color: "#059669" }}>
                                    +${payout}
                                  </div>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                    color: "#9ca3af" }}>${effectivePrice(w)} billed</div>
                                </div>
                                {undoingWalkKey === w.key ? (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
                                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                      color: "#dc2626", fontWeight: 600 }}>Undo?</div>
                                    <div style={{ display: "flex", gap: "4px" }}>
                                      <button onClick={() => undoWalkCompletion(w)}
                                        style={{ padding: "4px 10px", borderRadius: "6px", border: "none",
                                          background: "#dc2626", color: "#fff",
                                          fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                          fontWeight: 700, cursor: "pointer" }}>↩ Yes</button>
                                      <button onClick={() => setUndoingWalkKey(null)}
                                        style={{ padding: "4px 8px", borderRadius: "6px",
                                          border: "1px solid #e4e7ec", background: "#fff",
                                          color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                          fontSize: "16px", cursor: "pointer" }}>No</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => setUndoingWalkKey(w.key)}
                                    style={{ background: "none", border: "none", cursor: "pointer",
                                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                      color: "#9ca3af", padding: 0, textDecoration: "underline" }}>
                                    ↩ undo
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {/* Client subtotal footer */}
                        <div style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "center", padding: "12px 18px",
                          background: "#FDF5EC", borderTop: "1px solid #FDE8CC" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, color: "#374151" }}>
                            {walks.length} walk{walks.length !== 1 ? "s" : ""} with {clientName}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                            fontWeight: 600, color: "#C4541A" }}>
                            ${clientTotal} earned
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ── Availability ── */}
        {tab === "availability" && (
          <div className="fade-up">
            <style>{AVAIL_SLIDER_CSS}</style>

            {/* Same as Last Week — prominent banner */}
            {(() => {
              const prevHasData = prevWeekDates.some(d => (availability[toDateKey(d)] || []).length > 0);
              const applySameAsLastWeek = () => {
                const prevKeys = prevWeekDates.map(d => toDateKey(d));
                const currKeys = availWeekDates.map(d => toDateKey(d));
                setAvailability(prev => {
                  const next = { ...prev };
                  prevKeys.forEach((pk, i) => { next[currKeys[i]] = [...(prev[pk] || [])]; });
                  return next;
                });
                setAvailSaved(false);
                setSameAsLastWeekFlash(true);
                setTimeout(() => setSameAsLastWeekFlash(false), 2500);
              };
              if (!prevHasData) return null;
              return (
                <div style={{
                  background: sameAsLastWeekFlash ? "#6B3E1A" : "#C4541A",
                  borderRadius: "14px", padding: "16px 20px", marginBottom: "20px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: "12px",
                  boxShadow: "0 4px 16px rgba(26,107,74,0.25)",
                  transition: "background 0.3s ease",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: "22px", flexShrink: 0 }}>📋</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                          fontSize: "16px", color: "#fff" }}>
                          {sameAsLastWeekFlash ? "✓ Schedule copied from last week!" : "Repeat last week's schedule"}
                        </div>
                        {!sameAsLastWeekFlash && (
                          <button onClick={applySameAsLastWeek} style={{
                            padding: "5px 14px", borderRadius: "8px", border: "2px solid rgba(255,255,255,0.5)",
                            background: "rgba(255,255,255,0.15)", color: "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 700,
                            cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                            transition: "all 0.15s ease",
                          }}>
                            Use Last Week's Hours →
                          </button>
                        )}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                        color: "rgba(255,255,255,0.75)", marginTop: "3px" }}>
                        {sameAsLastWeekFlash
                          ? "Your availability has been filled in — review and save below."
                          : `Copy availability from ${prevWeekDates[0].toLocaleDateString("en-US",{month:"short",day:"numeric"})}–${prevWeekDates[6].toLocaleDateString("en-US",{month:"short",day:"numeric"})}`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Set Availability</div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
              marginBottom: "16px" }}>
              Drag the handles to set your start and end time for each day. Use <strong>All Day</strong>, <strong>AM</strong>, or <strong>PM</strong> to set quickly. Add a break by clicking <em>+ Add break / another shift</em>.
            </p>

            {/* Top save button */}
            {!availLoading && (() => {
              const allKeys = new Set([...Object.keys(availability), ...Object.keys(savedAvailability)]);
              const hasChanges = [...allKeys].some(dk =>
                JSON.stringify(availability[dk] || []) !== JSON.stringify(savedAvailability[dk] || [])
              );
              return (
                <button
                  onClick={hasChanges ? saveAllAvailability : undefined}
                  disabled={!hasChanges || availSaving}
                  style={{
                    width: "100%", padding: "12px", borderRadius: "12px", border: "none",
                    background: availSaved ? "#C4541A" : hasChanges ? accentBlue : "#e4e7ec",
                    color: hasChanges ? "#fff" : "#9ca3af",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 600,
                    cursor: hasChanges && !availSaving ? "pointer" : "not-allowed",
                    marginBottom: "16px", transition: "background 0.3s ease",
                    opacity: availSaving ? 0.7 : 1,
                  }}>
                  {availSaved ? "✓ Availability Saved!" : availSaving ? "Saving…" : hasChanges ? "Save Availability" : "No Changes to Save"}
                </button>
              );
            })()}

            {/* Week navigation */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: "16px", background: "#fff", borderRadius: "14px",
              border: "1.5px solid #e4e7ec", padding: "12px 16px" }}>
              <button onClick={() => { if (availWeekOffset > 0) setAvailWeekOffset(o => o - 1); }}
                disabled={availWeekOffset === 0}
                style={{ padding: "6px 14px", borderRadius: "8px", border: "1.5px solid #e4e7ec",
                  background: availWeekOffset === 0 ? "#f3f4f6" : "#fff",
                  color: availWeekOffset === 0 ? "#d1d5db" : "#374151",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: availWeekOffset === 0 ? "default" : "pointer" }}>
                ← Prev
              </button>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "15px", color: "#111827" }}>
                  {availWeekOffset === 0 ? "This Week" : availWeekOffset === 1 ? "Next Week" : `+${availWeekOffset} weeks`}
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                  {availWeekDates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {availWeekDates[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </div>
              </div>
              <button onClick={() => { if (availWeekOffset < 11) setAvailWeekOffset(o => o + 1); }}
                disabled={availWeekOffset >= 11}
                style={{ padding: "6px 14px", borderRadius: "8px", border: "1.5px solid #e4e7ec",
                  background: availWeekOffset >= 11 ? "#f3f4f6" : "#fff",
                  color: availWeekOffset >= 11 ? "#d1d5db" : "#374151",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: availWeekOffset >= 11 ? "default" : "pointer" }}>
                Next →
              </button>
            </div>


            {availLoading ? (
              <div style={{ textAlign: "center", padding: "40px", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", color: "#9ca3af" }}>Loading availability...</div>
            ) : (
              <>
                {availWeekDates.map(date => {
                  const dateKey = toDateKey(date);
                  const daySlots = availability[dateKey] || [];
                  const count = daySlots.length;
                  const isCopySource = copySourceDate === dateKey;
                  const isPast = date < new Date(new Date().setHours(0,0,0,0));
                  const isToday = toDateKey(date) === toDateKey(new Date());

                  const AM_SLOTS = TAB_SLOTS.filter(s => s.includes("AM"));
                  const PM_SLOTS = TAB_SLOTS.filter(s => s.includes("PM"));
                  const shifts = slotsToShifts(daySlots);
                  const isAllDay = shifts.length === 1 && shifts[0].start === 0 && shifts[0].end === TAB_SLOTS.length - 1;
                  const isAM    = shifts.length === 1 && shifts[0].start === 0 && shifts[0].end === AM_SLOTS.length - 1;
                  const isPM    = shifts.length === 1 && shifts[0].start === AM_SLOTS.length && shifts[0].end === TAB_SLOTS.length - 1;

                  const setDaySlots = (newSlots) => {
                    setAvailability(prev => ({ ...prev, [dateKey]: newSlots }));
                    setAvailSaved(false);
                  };

                  return (
                    <div key={dateKey} style={{
                      background: isPast ? "#fafafa" : "#fff",
                      border: isCopySource ? `2px solid ${accentBlue}` : "1.5px solid #e4e7ec",
                      borderRadius: "16px", padding: "16px 18px", marginBottom: "12px",
                      opacity: isPast ? 0.6 : 1,
                      boxShadow: isCopySource ? `0 0 0 3px ${accentBlue}18` : "none",
                      transition: "all 0.15s",
                    }}>
                      {/* Day header row */}
                      <div style={{ display: "flex", alignItems: "center",
                        justifyContent: "space-between", marginBottom: "10px", gap: "8px", flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                              fontSize: "16px", color: "#111827", display: "flex", alignItems: "center", gap: "6px" }}>
                              {date.toLocaleDateString("en-US", { weekday: "long" })}
                              {isToday && <span style={{ fontSize: "16px", background: "#C4541A",
                                color: "#fff", borderRadius: "4px", padding: "1px 6px", fontWeight: 600 }}>TODAY</span>}
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                              {date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </div>
                          </div>
                          {count > 0 && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: accentBlue, background: `${accentBlue}12`,
                              padding: "2px 8px", borderRadius: "20px", fontWeight: 600 }}>
                              {count} slot{count !== 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                        {!isPast && (
                          <div style={{ display: "flex", gap: "6px", flexShrink: 0, flexWrap: "wrap" }}>
                            {/* Quick-set presets */}
                            {[
                              { label: "All Day", active: isAllDay,
                                slots: TAB_SLOTS },
                              { label: "AM", active: isAM,
                                slots: AM_SLOTS },
                              { label: "PM", active: isPM,
                                slots: PM_SLOTS },
                            ].map(({ label, active, slots: ps }) => (
                              <button key={label}
                                onClick={() => setDaySlots(active ? [] : ps)}
                                style={{ padding: "4px 11px", borderRadius: "7px", fontSize: "15px",
                                  fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
                                  border: active ? `1.5px solid ${accentBlue}` : "1.5px solid #d1d5db",
                                  background: active ? `${accentBlue}12` : "#f9fafb",
                                  color: active ? accentBlue : "#6b7280",
                                  fontWeight: active ? 600 : 500, transition: "all 0.12s", whiteSpace: "nowrap" }}>
                                {active ? `✓ ${label}` : label}
                              </button>
                            ))}
                            {/* Clear */}
                            {count > 0 && (
                              <button onClick={() => setDaySlots([])}
                                style={{ padding: "4px 11px", borderRadius: "7px", fontSize: "15px",
                                  fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
                                  border: "1.5px solid #fecaca", background: "#fef2f2",
                                  color: "#dc2626", fontWeight: 500, whiteSpace: "nowrap" }}>
                                Clear
                              </button>
                            )}
                            {/* Copy */}
                            <button onClick={() => {
                              if (isCopySource) { setCopySourceDate(null); setCopyTargetDates([]); }
                              else { setCopySourceDate(dateKey); setCopyTargetDates([]); setImportPickerKey(null); }
                            }} disabled={count === 0}
                            data-tooltip={isCopySource ? "Cancel copy" : "Copy to other days"}
                            style={{
                              padding: "4px 11px", borderRadius: "7px", fontSize: "15px",
                              fontFamily: "'DM Sans', sans-serif",
                              cursor: count > 0 ? "pointer" : "default",
                              border: isCopySource ? `1.5px solid ${accentBlue}` : "1.5px solid #d1d5db",
                              background: isCopySource ? accentBlue : count > 0 ? "#f9fafb" : "#f3f4f6",
                              color: isCopySource ? "#fff" : count > 0 ? "#6b7280" : "#d1d5db",
                              fontWeight: isCopySource ? 600 : 500, transition: "all 0.12s",
                            }}>
                              {isCopySource ? "✕" : "📋"}
                            </button>
                            <button onClick={() => {
                              setImportPickerKey(importPickerKey === dateKey ? null : dateKey);
                              setCopySourceDate(null); setCopyTargetDates([]);
                            }} data-tooltip="Import from previous week" style={{
                              padding: "4px 11px", borderRadius: "7px", fontSize: "15px",
                              fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
                              border: importPickerKey === dateKey ? `1.5px solid ${accentBlue}` : "1.5px solid #d1d5db",
                              background: importPickerKey === dateKey ? accentBlue : "#f9fafb",
                              color: importPickerKey === dateKey ? "#fff" : "#6b7280",
                              fontWeight: importPickerKey === dateKey ? 600 : 500, transition: "all 0.12s",
                            }}>
                              ↙
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Shift sliders */}
                      <DayAvailSliders
                        slots={daySlots}
                        onChange={setDaySlots}
                        color={accentBlue}
                        isPast={isPast}
                      />

                      {/* Inline copy picker — shown when this day is the copy source */}
                      {isCopySource && (
                        <div className="fade-up" style={{ marginTop: "12px", borderTop: `1.5px solid ${accentBlue}22`,
                          paddingTop: "12px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, color: accentBlue, marginBottom: "10px" }}>
                            Copy to which days this week?
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                            {availWeekDates.map(d => {
                              const dk = toDateKey(d);
                              if (dk === copySourceDate) return null;
                              const isPastDay = d < new Date(new Date().setHours(0,0,0,0));
                              if (isPastDay) return null;
                              const isTarget = copyTargetDates.includes(dk);
                              return (
                                <button key={dk} onClick={() => setCopyTargetDates(prev =>
                                  prev.includes(dk) ? prev.filter(x => x !== dk) : [...prev, dk]
                                )} style={{
                                  padding: "5px 12px", borderRadius: "8px", fontSize: "16px",
                                  fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
                                  border: isTarget ? `1.5px solid ${accentBlue}` : "1.5px solid #d1d5db",
                                  background: isTarget ? accentBlue : "#fff",
                                  color: isTarget ? "#fff" : "#6b7280",
                                  fontWeight: isTarget ? 600 : 400, transition: "all 0.12s",
                                }}>
                                  {d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                </button>
                              );
                            })}
                            <button onClick={() => {
                              const futureDates = availWeekDates
                                .filter(d => toDateKey(d) !== copySourceDate && d >= new Date(new Date().setHours(0,0,0,0)))
                                .map(d => toDateKey(d));
                              const allSelected = futureDates.every(dk => copyTargetDates.includes(dk));
                              setCopyTargetDates(allSelected ? [] : futureDates);
                            }} style={{
                              padding: "5px 12px", borderRadius: "8px", fontSize: "16px",
                              fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
                              border: "1.5px solid #d1d5db", background: "#f3f4f6",
                              color: "#374151", fontWeight: 500,
                            }}>All</button>
                          </div>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button onClick={applyCopyDate} disabled={copyTargetDates.length === 0} style={{
                              padding: "8px 16px", borderRadius: "9px", border: "none",
                              background: copyTargetDates.length > 0 ? accentBlue : "#d1d5db",
                              color: "#fff", fontFamily: "'DM Sans', sans-serif",
                              fontSize: "16px", fontWeight: 600,
                              cursor: copyTargetDates.length > 0 ? "pointer" : "default",
                            }}>
                              Apply → {copyTargetDates.length > 0 ? `${copyTargetDates.length} day${copyTargetDates.length > 1 ? "s" : ""}` : ""}
                            </button>
                            <button onClick={() => { setCopySourceDate(null); setCopyTargetDates([]); }} style={{
                              padding: "8px 14px", borderRadius: "9px",
                              border: "1.5px solid #e4e7ec", background: "#fff",
                              color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                              fontSize: "16px", cursor: "pointer",
                            }}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Import from previous week picker */}
                      {importPickerKey === dateKey && (
                        <div className="fade-up" style={{ marginTop: "12px", borderTop: `1.5px solid ${accentBlue}22`,
                          paddingTop: "12px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, color: accentBlue, marginBottom: "10px" }}>
                            ↙ Import slots from which day?
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                            {prevWeekDates.map((d, di) => {
                              const dk = toDateKey(d);
                              const prevSlots = availability[dk] || [];
                              const isEmpty = prevSlots.length === 0;
                              const isSameWeekday = availWeekDates.findIndex(wd => toDateKey(wd) === dateKey) === di;
                              return (
                                <button key={dk} onClick={() => {
                                  if (!isEmpty) {
                                    setAvailability(prev => ({ ...prev, [dateKey]: [...prevSlots] }));
                                    setAvailSaved(false);
                                    setImportPickerKey(null);
                                  }
                                }} disabled={isEmpty} style={{
                                  padding: "5px 12px", borderRadius: "8px", fontSize: "16px",
                                  fontFamily: "'DM Sans', sans-serif",
                                  cursor: isEmpty ? "default" : "pointer",
                                  border: isSameWeekday && !isEmpty
                                    ? `1.5px solid ${accentBlue}` : "1.5px solid #d1d5db",
                                  background: isEmpty ? "#f9fafb" : isSameWeekday ? `${accentBlue}10` : "#fff",
                                  color: isEmpty ? "#d1d5db" : isSameWeekday ? accentBlue : "#6b7280",
                                  fontWeight: isSameWeekday && !isEmpty ? 600 : 400,
                                  transition: "all 0.12s",
                                }}>
                                  {d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                  {!isEmpty && <span style={{ marginLeft: "4px", fontSize: "16px",
                                    color: "#9ca3af" }}>({prevSlots.length})</span>}
                                </button>
                              );
                            })}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af", marginBottom: "8px" }}>
                            Greyed-out days have no slots saved from that week. Clicking a day immediately imports its slots here.
                          </div>
                          <button onClick={() => setImportPickerKey(null)} style={{
                            padding: "7px 14px", borderRadius: "9px",
                            border: "1.5px solid #e4e7ec", background: "#fff",
                            color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "16px", cursor: "pointer",
                          }}>Cancel</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* Save button */}
            {!availLoading && (() => {
              const allKeys = new Set([...Object.keys(availability), ...Object.keys(savedAvailability)]);
              const hasChanges = [...allKeys].some(dk =>
                JSON.stringify(availability[dk] || []) !== JSON.stringify(savedAvailability[dk] || [])
              );
              return (
                <button
                  onClick={hasChanges ? saveAllAvailability : undefined}
                  disabled={!hasChanges || availSaving}
                  style={{
                    width: "100%", padding: "15px", borderRadius: "12px", border: "none",
                    background: availSaved ? "#C4541A" : hasChanges ? accentBlue : "#e4e7ec",
                    color: hasChanges ? "#fff" : "#9ca3af",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    fontWeight: 600,
                    cursor: hasChanges && !availSaving ? "pointer" : "not-allowed",
                    marginTop: "16px", transition: "background 0.3s ease",
                    opacity: availSaving ? 0.7 : 1,
                  }}>
                  {availSaved ? "✓ Availability Saved!" : availSaving ? "Saving…" : hasChanges ? "Save Availability" : "No Changes to Save"}
                </button>
              );
            })()}
          </div>
        )}

        {/* ── Payouts ── */}
        {tab === "payouts" && (() => {
          // Gratuity from paid invoices on this walker's key clients
          const { monday: wMonG, sunday: wSunG } = getCurrentWeekRange();
          const paidInvsWithGrat = myKeyClients.flatMap(c =>
            (c.invoices || []).filter(inv => inv.status === "paid" && inv.gratuity > 0)
          );
          const weekGratuity    = paidInvsWithGrat.filter(inv => {
            const d = new Date(inv.paidAt); return d >= wMonG && d <= wSunG;
          }).reduce((s, inv) => s + (inv.gratuity || 0), 0);
          const allTimeGratuity = paidInvsWithGrat.reduce((s, inv) => s + (inv.gratuity || 0), 0);

          // Build a map from bookingKey → gratuity amount (split evenly across walks in invoice)
          const gratByWalkKey = {};
          paidInvsWithGrat.forEach(inv => {
            const walkItems = (inv.items || []).filter(it => it.bookingKey);
            if (walkItems.length === 0) return;
            const perWalk = (inv.gratuity || 0) / walkItems.length;
            walkItems.forEach(it => {
              gratByWalkKey[it.bookingKey] = (gratByWalkKey[it.bookingKey] || 0) + perWalk;
            });
          });

          return (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "20px" }}>Payouts & Earnings</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              {[
                { label: "Week's Earnings", value: fmt(weekEarned, true), icon: "📅", color: accentBlue },
                { label: "All-Time Earnings", value: fmt(totalEarned, true), icon: "💵", color: "#C4541A" },
                { label: "Walks This Week", value: thisWeek.length.toString(), icon: "🐕", color: "#b45309" },
                { label: "All-Time Walks", value: completedWalks.length.toString(), icon: "🏅", color: "#7A4D6E" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", border: `1.5px solid ${s.color}22`,
                  borderRadius: "14px", padding: "18px 16px" }}>
                  <div style={{ fontSize: "20px", marginBottom: "8px" }}>{s.icon}</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: s.color }}>{s.value}</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#9ca3af", marginTop: "4px" }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Gratuity section */}
            <div style={{ background: "#FDF5EC", border: "1.5px solid #D4A87A",
              borderRadius: "14px", padding: "16px 18px", marginBottom: "20px" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700,
                letterSpacing: "1.5px", textTransform: "uppercase", color: "#C4541A", marginBottom: "12px" }}>
                Gratuities (100% yours)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                {[
                  { label: "This Week's Gratuity", value: weekGratuity > 0 ? fmt(weekGratuity, true) : "—" },
                  { label: "All-Time Gratuity",    value: allTimeGratuity > 0 ? fmt(allTimeGratuity, true) : "—" },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "22px",
                      fontWeight: 700, color: "#C4541A" }}>{s.value}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                      color: "#9ca3af", marginTop: "3px" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
              borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                fontSize: "15px", color: "#374151", marginBottom: "14px" }}>
                Payout Rates: $20 · 30 min | $35 · 60 min (Full Gallop: $18 · 30 min | $32 · 60 min)
              </div>
              {completedWalks.length === 0 ? (
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#9ca3af", textAlign: "center", padding: "20px 0" }}>
                  No completed walks yet.
                </div>
              ) : completedWalks.slice().sort((a, b) =>
                new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) - new Date(a.completedAt || a.scheduledDateTime || a.bookedAt)
              ).map((b, i) => {
                const isOpen = expandedWalkKey === `pay_${b.key || i}`;
                const payout = Math.round(getWalkerPayout(b));
                const walkGrat = gratByWalkKey[b.key] || 0;
                return (
                  <div key={b.key || i} style={{
                    borderBottom: i < completedWalks.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <button onClick={() => setExpandedWalkKey(isOpen ? null : `pay_${b.key || i}`)}
                      style={{ width: "100%", background: "none", border: "none", cursor: "pointer",
                        textAlign: "left", padding: "11px 0",
                        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: 500, color: "#111827" }}>
                          {b.clientName} — {b.form?.pet || "Walk"} · {b.slot?.duration}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                          color: "#9ca3af", marginTop: "1px" }}>
                          {b.day}, {b.date}
                          {b.walkerMarkedComplete && (
                            <span style={{ marginLeft: "6px", color: "#059669", fontWeight: 600 }}>· ✓ marked by you</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 600, color: "#C4541A" }}>+${payout}</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                            color: "#9ca3af" }}>of ${effectivePrice(b)}</div>
                          {walkGrat > 0 && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                              fontWeight: 600, color: "#059669",
                              background: "#f0fdf4", border: "1px solid #a8d5bf",
                              borderRadius: "5px", padding: "1px 6px", marginTop: "3px" }}>
                              +${walkGrat.toFixed(2)} tip
                            </div>
                          )}
                        </div>
                        <span style={{ color: "#9ca3af", fontSize: "13px",
                          transform: isOpen ? "rotate(180deg)" : "none",
                          display: "inline-block", transition: "transform 0.15s" }}>▾</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="fade-up" style={{ background: "#f9fafb",
                        borderRadius: "12px", padding: "12px 14px", marginBottom: "10px",
                        border: "1.5px solid #e4e7ec" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px",
                          fontFamily: "'DM Sans', sans-serif" }}>
                          {[
                            ["Client", b.clientName],
                            ["Pet", b.form?.pet || "—"],
                            ["Service", b.service === "cat" ? "Cat-sitting" : b.isOvernight ? "Overnight" : "Dog walk"],
                            ["Duration", b.slot?.duration || "30 min"],
                            ["Date", `${b.day}, ${b.date}`],
                            ["Time", b.slot?.time || "—"],
                            ["Session Rate", `$${effectivePrice(b)}`],
                            ["Your Payout", `$${payout}`],
                            ...(walkGrat > 0 ? [["Gratuity", `$${walkGrat.toFixed(2)}`]] : []),
                          ].map(([label, val]) => (
                            <div key={label}>
                              <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af",
                                textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
                              <div style={{ fontSize: "14px", color: "#111827",
                                fontWeight: 500, marginTop: "2px" }}>{val}</div>
                            </div>
                          ))}
                        </div>
                        {b.form?.notes && (
                          <div style={{ marginTop: "10px", paddingTop: "10px",
                            borderTop: "1px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif" }}>
                            <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af",
                              textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "3px" }}>Notes</div>
                            <div style={{ fontSize: "14px", color: "#374151" }}>{b.form.notes}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ background: `${accentBlue}10`, border: `1.5px solid ${accentBlue}33`,
              borderRadius: "14px", padding: "16px 18px", marginTop: "16px" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: accentBlue, fontWeight: 600, marginBottom: "4px" }}>💳 Next Payout</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#374151" }}>
                Payouts are processed every Friday via direct deposit. Make sure your banking info is up to date with admin.
              </div>
            </div>

            {/* ── Export buttons ── */}
            {completedWalks.length > 0 && (() => {
              const exportRows = completedWalks.slice().sort((a, b) =>
                new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) -
                new Date(a.completedAt || a.scheduledDateTime || a.bookedAt)
              ).map(b => ({
                Date:              b.date || "",
                Day:               b.day  || "",
                Client:            b.clientName || "",
                Pet:               b.form?.pet || "",
                Service:           b.form?.service === "cat" ? "Cat-sitting" : "Dog-walking",
                Duration:          b.slot?.duration || "",
                "Total Price ($)": effectivePrice(b),
                "Your Payout ($)": Math.round(getWalkerPayout(b)),
              }));

              const exportCSV = () => {
                const headers = Object.keys(exportRows[0]);
                const csv = [
                  headers.join(","),
                  ...exportRows.map(r =>
                    headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
                  ),
                ].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement("a");
                a.href = url;
                a.download = `${walker.name.replace(/\s+/g, "-")}-payouts.csv`;
                a.click();
                URL.revokeObjectURL(url);
              };

              const exportXLSX = async () => {
                if (!window.XLSX) {
                  await new Promise((resolve, reject) => {
                    const s = document.createElement("script");
                    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
                    s.onload = resolve; s.onerror = reject;
                    document.head.appendChild(s);
                  });
                }
                const XLSX = window.XLSX;
                const wb = XLSX.utils.book_new();

                // ── Summary sheet ──
                const summaryData = [
                  ["Lonestar Bark Co. — Earnings Summary"],
                  [],
                  ["Walker",        walker.name],
                  ["Payout Rate",   "$20/30 min · $35/60 min (Full Gallop: $18/$32)"],
                  ["Walks Total",   completedWalks.length],
                  ["Total Earned",  fmt(totalEarned, true)],
                  ["Week's Earnings",     fmt(weekEarned, true)],
                  ["Exported",      new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })],
                ];
                const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
                wsSummary["!cols"] = [{ wch: 22 }, { wch: 28 }];
                XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

                // ── Walk detail sheet ──
                const headers = Object.keys(exportRows[0]);
                const wsData  = [headers, ...exportRows.map(r => headers.map(h => r[h]))];
                const wsDetail = XLSX.utils.aoa_to_sheet(wsData);
                wsDetail["!cols"] = [
                  { wch: 12 }, // Date
                  { wch: 10 }, // Day
                  { wch: 20 }, // Client
                  { wch: 14 }, // Pet
                  { wch: 14 }, // Service
                  { wch: 10 }, // Duration
                  { wch: 16 }, // Total Price
                  { wch: 16 }, // Your Payout
                ];
                XLSX.utils.book_append_sheet(wb, wsDetail, "Walk Detail");

                XLSX.writeFile(wb, `${walker.name.replace(/\s+/g, "-")}-payouts.xlsx`);
              };

              return (
                <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
                  <button onClick={exportCSV} style={{
                    flex: 1, padding: "11px 16px", borderRadius: "10px",
                    border: "1.5px solid #e4e7ec", background: "#fff",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 600, color: "#374151", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                    transition: "all 0.15s",
                  }}>
                    📄 Export CSV
                  </button>
                  <button onClick={exportXLSX} style={{
                    flex: 1, padding: "11px 16px", borderRadius: "10px",
                    border: "none", background: "#C4541A",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 600, color: "#fff", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                    transition: "all 0.15s",
                  }}>
                    📊 Export Excel
                  </button>
                </div>
              );
            })()}
          </div>
          );
        })()}

        {/* ── Shift Trades ── */}
        {tab === "trades" && (() => {
          const myTrades = (trades || []);
          const tradesQ = walkerTradesSearch.toLowerCase();
          // Trades offered BY this walker (outgoing)
          const myOffers = myTrades.filter(t => {
            if (t.fromWalker !== walker.name) return false;
            if (!tradesQ) return true;
            return (
              (t.clientName || "").toLowerCase().includes(tradesQ) ||
              (t.pet || "").toLowerCase().includes(tradesQ) ||
              (t.date || "").toLowerCase().includes(tradesQ) ||
              (t.day || "").toLowerCase().includes(tradesQ) ||
              (t.status || "").toLowerCase().includes(tradesQ)
            );
          });
          // Trades offered TO all others that this walker can accept (incoming — offered by others, pending)
          const incoming = myTrades.filter(t => {
            if (t.fromWalker === walker.name || t.status !== "pending") return false;
            if (!tradesQ) return true;
            return (
              (t.clientName || "").toLowerCase().includes(tradesQ) ||
              (t.pet || "").toLowerCase().includes(tradesQ) ||
              (t.date || "").toLowerCase().includes(tradesQ) ||
              (t.fromWalker || "").toLowerCase().includes(tradesQ)
            );
          });

          const submitOffer = () => {
            const booking = myWalks.find(b => b.key === offerBookingKey);
            if (!booking) return;
            const newTrade = {
              id: `trade_${Date.now()}`,
              fromWalker: walker.name,
              fromWalkerAvatar: walker.avatar,
              bookingKey: booking.key,
              clientName: booking.clientName,
              pet: booking.form?.pet || "Pet",
              day: booking.day,
              date: booking.date,
              time: booking.slot?.time,
              duration: booking.slot?.duration,
              clientId: booking.clientId || Object.keys(clients).find(cid =>
                (clients[cid].bookings || []).some(bk => bk.key === booking.key)
              ),
              bonus: offerBonus ? parseFloat(offerBonus) : 0,
              reason: offerReason.trim(),
              keySwap: offerKeySwap,
              status: "pending",
              createdAt: new Date().toISOString(),
            };
            setTrades([...myTrades, newTrade]);
            saveTrades([...myTrades, newTrade]);
            notifyAdmin("shift_trade", {
              walkerName: walker.name,
              action: "Offered",
              date: newTrade.date,
              clientName: newTrade.clientName,
            });
            setOfferBookingKey(null);
            setOfferBonus("");
            setOfferReason("");
            setOfferKeySwap(false);
          };

          const acceptTrade = (trade) => {
            // Reassign the booking to this walker
            const clientId = trade.clientId;
            if (clientId && clients[clientId]) {
              const updatedClients = {
                ...clients,
                [clientId]: {
                  ...clients[clientId],
                  bookings: (clients[clientId].bookings || []).map(bk =>
                    bk.key === trade.bookingKey
                      ? { ...bk, form: { ...bk.form, walker: walker.name } }
                      : bk
                  ),
                  // If the trade included a key swap, transfer keyholder to the accepting walker
                  ...(trade.keySwap ? { keyholder: walker.name } : {}),
                },
              };
              setClients(updatedClients);
            }
            // Mark trade as accepted
            const acceptedTrades = myTrades.map(t =>
              t.id === trade.id
                ? { ...t, status: "accepted", acceptedBy: walker.name, acceptedAt: new Date().toISOString() }
                : t
            );
            setTrades(acceptedTrades);
            saveTrades(acceptedTrades);
            notifyAdmin("shift_trade", {
              walkerName: walker.name,
              action: "Accepted",
              date: trade.date,
              clientName: trade.clientName,
            });
          };

          const declineTrade = (trade) => {
            const declinedTrades = myTrades.map(t =>
              t.id === trade.id
                ? { ...t, status: "declined", declinedBy: walker.name, declinedAt: new Date().toISOString() }
                : t
            );
            setTrades(declinedTrades);
            saveTrades(declinedTrades);
          };

          const cancelOffer = (trade) => {
            const filteredTrades = myTrades.filter(t => t.id !== trade.id);
            setTrades(filteredTrades);
            saveTrades(filteredTrades);
          };

          const sectionLabel = (text) => (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
              fontSize: "15px", color: "#9ca3af", letterSpacing: "1.5px",
              textTransform: "uppercase", marginBottom: "12px" }}>{text}</div>
          );

          const statusBadge = (status) => {
            const map = {
              pending:  { bg: "#fffbeb", border: "#fde68a", color: "#92400e", label: "Pending" },
              accepted: { bg: "#FDF5EC", border: "#F0E8D5", color: "#059669", label: "✓ Accepted" },
              declined: { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", label: "✕ Declined" },
            };
            const s = map[status] || map.pending;
            return (
              <div style={{ background: s.bg, border: `1px solid ${s.border}`,
                borderRadius: "5px", padding: "2px 8px",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                fontWeight: 700, color: s.color }}>{s.label}</div>
            );
          };

          return (
            <div className="fade-up">
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#111827", marginBottom: "6px" }}>Shift Trades</div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
                marginBottom: "14px" }}>
                Offer one of your walks for another walker to pick up — optionally sweeten it with a bonus.
              </p>

              {/* Search bar */}
              <div style={{ position: "relative", marginBottom: "20px" }}>
                <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)",
                  fontSize: "16px", pointerEvents: "none" }}>🔍</span>
                <input
                  value={walkerTradesSearch}
                  onChange={e => setWalkerTradesSearch(e.target.value)}
                  placeholder="Search by client, pet, date, status…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px",
                    borderRadius: "10px", border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", color: "#111827", background: "#fff", outline: "none" }}
                />
                {walkerTradesSearch && (
                  <button onClick={() => setWalkerTradesSearch("")} style={{ position: "absolute", right: "10px",
                    top: "50%", transform: "translateY(-50%)", background: "none", border: "none",
                    cursor: "pointer", color: "#9ca3af", fontSize: "16px" }}>✕</button>
                )}
              </div>

              {/* ── Offer a Walk ── */}
              {sectionLabel("Offer a Walk for Trade")}
              <div style={{ background: "#fff", border: `1.5px solid ${accentBlue}33`,
                borderRadius: "14px", padding: "18px", marginBottom: "28px" }}>
                {myWalks.length === 0 ? (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#9ca3af", textAlign: "center", padding: "12px 0" }}>
                    No upcoming walks to offer for trade.
                  </div>
                ) : (
                  <>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#6b7280", marginBottom: "12px" }}>
                      Select a walk to put up for trade:
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "14px" }}>
                      {myWalks.map(b => {
                        const alreadyOffered = myOffers.some(t => t.bookingKey === b.key && t.status === "pending");
                        const isSelected = offerBookingKey === b.key;
                        return (
                          <button key={b.key} onClick={() => setOfferBookingKey(isSelected ? null : b.key)}
                            disabled={alreadyOffered}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "11px 14px", borderRadius: "10px", cursor: alreadyOffered ? "default" : "pointer",
                              border: isSelected ? `2px solid ${accentBlue}` : "1.5px solid #e4e7ec",
                              background: isSelected ? `${accentBlue}08` : alreadyOffered ? "#f9fafb" : "#fff",
                              textAlign: "left", width: "100%",
                            }}>
                            <div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                fontSize: "15px", color: alreadyOffered ? "#9ca3af" : "#111827" }}>
                                {b.form?.pet || "Pet"} · {b.clientName}
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                color: "#9ca3af", marginTop: "2px" }}>
                                {b.day}, {b.date} · {b.slot?.time} · {b.slot?.duration}
                              </div>
                            </div>
                            {alreadyOffered
                              ? <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                  color: "#9ca3af", fontStyle: "italic" }}>Already offered</div>
                              : isSelected
                                ? <div style={{ color: accentBlue, fontSize: "16px" }}>✓</div>
                                : null}
                          </button>
                        );
                      })}
                    </div>

                    {offerBookingKey && (
                      <div className="fade-up">
                        {/* Bonus */}
                        <div style={{ marginBottom: "10px" }}>
                          <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", fontWeight: 700, letterSpacing: "1px",
                            textTransform: "uppercase", color: "#9ca3af", marginBottom: "6px" }}>
                            Bonus $ (optional)
                          </label>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: "#6b7280" }}>$</span>
                            <input
                              type="number" min="0" step="1"
                              value={offerBonus}
                              onChange={e => setOfferBonus(e.target.value)}
                              placeholder="0"
                              style={{ flex: 1, padding: "9px 12px", borderRadius: "9px",
                                border: "1.5px solid #e4e7ec", background: "#f9fafb",
                                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                color: "#111827", outline: "none" }}
                            />
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af", marginTop: "4px" }}>
                            Add an extra incentive for whoever picks up your walk.
                          </div>
                        </div>
                        {/* Reason */}
                        <div style={{ marginBottom: "12px" }}>
                          <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", fontWeight: 700, letterSpacing: "1px",
                            textTransform: "uppercase", color: "#9ca3af", marginBottom: "6px" }}>
                            Reason (optional)
                          </label>
                          <input
                            value={offerReason}
                            onChange={e => setOfferReason(e.target.value)}
                            placeholder="e.g. Doctor appointment, family commitment…"
                            style={{ width: "100%", padding: "9px 12px", borderRadius: "9px",
                              border: "1.5px solid #e4e7ec", background: "#f9fafb",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#111827", outline: "none" }}
                          />
                        </div>
                        {/* Key Swap — only shown if this walker is the keyholder for this client */}
                        {(() => {
                          const offerBooking = myWalks.find(b => b.key === offerBookingKey);
                          const offerClientId = offerBooking?.clientId || Object.keys(clients).find(cid =>
                            (clients[cid].bookings || []).some(bk => bk.key === offerBookingKey)
                          );
                          const isKeyholder = offerClientId && clients[offerClientId]?.keyholder === walker.name;
                          if (!isKeyholder) return null;
                          return (
                            <button
                              onClick={() => setOfferKeySwap(v => !v)}
                              style={{
                                display: "flex", alignItems: "center", gap: "10px",
                                width: "100%", padding: "11px 14px", borderRadius: "10px",
                                border: `1.5px solid ${offerKeySwap ? "#b45309" : "#e4e7ec"}`,
                                background: offerKeySwap ? "#fffbeb" : "#f9fafb",
                                cursor: "pointer", textAlign: "left", marginBottom: "12px",
                              }}>
                              <span style={{ fontSize: "18px" }}>🗝️</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                  fontSize: "15px", color: offerKeySwap ? "#92400e" : "#374151" }}>
                                  Include key handoff
                                </div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: "#9ca3af", marginTop: "1px" }}>
                                  You currently hold the key for this client. Check this if you'll hand it off with the walk.
                                </div>
                              </div>
                              <div style={{
                                width: "20px", height: "20px", borderRadius: "5px", flexShrink: 0,
                                border: `2px solid ${offerKeySwap ? "#b45309" : "#d1d5db"}`,
                                background: offerKeySwap ? "#b45309" : "#fff",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}>
                                {offerKeySwap && <span style={{ color: "#fff", fontSize: "16px", lineHeight: 1 }}>✓</span>}
                              </div>
                            </button>
                          );
                        })()}
                        <button onClick={submitOffer} style={{
                          width: "100%", padding: "11px", borderRadius: "10px", border: "none",
                          background: accentBlue, color: "#fff",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: 600, cursor: "pointer",
                        }}>
                          Post Trade Offer →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Incoming Offers (from other walkers) ── */}
              {sectionLabel(`Available Trades (${incoming.length})`)}
              {incoming.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: "14px", padding: "28px",
                  textAlign: "center", border: "1.5px solid #e4e7ec", marginBottom: "24px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#9ca3af", fontSize: "15px" }}>
                    No open trade offers right now.
                  </div>
                </div>
              ) : incoming.map(trade => (
                <div key={trade.id} style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                  borderRadius: "14px", padding: "18px", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start",
                    justifyContent: "space-between", gap: "10px", marginBottom: "10px" }}>
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                        fontSize: "16px", color: "#111827", marginBottom: "3px" }}>
                        {trade.fromWalkerAvatar} {trade.fromWalker} is offering:
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#374151", marginBottom: "2px" }}>
                        🐕 {trade.pet} · {trade.clientName}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        color: "#6b7280" }}>
                        📅 {trade.day}, {trade.date} · {trade.time} · {trade.duration}
                      </div>
                      {trade.reason && (
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#9ca3af", marginTop: "4px" }}>
                          Reason: {trade.reason}
                        </div>
                      )}
                      {trade.keySwap && (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "5px",
                          marginTop: "6px", background: "#fffbeb", border: "1px solid #fde68a",
                          borderRadius: "6px", padding: "3px 9px" }}>
                          <span style={{ fontSize: "15px" }}>🗝️</span>
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 700, color: "#92400e", textTransform: "uppercase",
                            letterSpacing: "0.5px" }}>Key included — you'll become keyholder</span>
                        </div>
                      )}
                    </div>
                    {trade.bonus > 0 && (
                      <div style={{ flexShrink: 0, background: "#fffbeb",
                        border: "1.5px solid #fde68a", borderRadius: "10px",
                        padding: "8px 12px", textAlign: "center" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color: "#b45309" }}>
                          +${trade.bonus}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#b45309", fontWeight: 700, textTransform: "uppercase",
                          letterSpacing: "0.5px" }}>bonus</div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => acceptTrade(trade)} style={{
                      flex: 1, padding: "9px", borderRadius: "9px", border: "none",
                      background: "#C4541A", color: "#fff",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      fontWeight: 600, cursor: "pointer",
                    }}>✓ Accept Walk</button>
                    <button onClick={() => declineTrade(trade)} style={{
                      flex: 1, padding: "9px", borderRadius: "9px",
                      border: "1.5px solid #e4e7ec", background: "#fff",
                      color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "16px", cursor: "pointer",
                    }}>✕ Pass</button>
                  </div>
                </div>
              ))}

              {/* ── My Sent Offers ── */}
              {myOffers.length > 0 && (
                <>
                  {sectionLabel("My Offers")}
                  {myOffers.map(trade => (
                    <div key={trade.id} style={{ background: "#fff",
                      border: "1.5px solid #e4e7ec", borderRadius: "14px",
                      padding: "16px 18px", marginBottom: "10px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start",
                        justifyContent: "space-between", gap: "10px" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                            fontSize: "15px", color: "#111827", marginBottom: "3px" }}>
                            🐕 {trade.pet} · {trade.clientName}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#6b7280", marginBottom: "3px" }}>
                            📅 {trade.day}, {trade.date} · {trade.time}
                          </div>
                          {trade.bonus > 0 && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#b45309" }}>+${trade.bonus} bonus offered</div>
                          )}
                          {trade.reason && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#9ca3af", marginTop: "2px" }}>"{trade.reason}"</div>
                          )}
                          {trade.keySwap && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "5px",
                              marginTop: "5px", background: "#fffbeb", border: "1px solid #fde68a",
                              borderRadius: "5px", padding: "2px 7px" }}>
                              <span style={{ fontSize: "16px" }}>🗝️</span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                fontWeight: 700, color: "#92400e" }}>Key swap included</span>
                            </div>
                          )}
                          {trade.status === "accepted" && trade.acceptedBy && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#059669", marginTop: "4px", fontWeight: 600 }}>
                              Accepted by {trade.acceptedBy}
                              {trade.keySwap && <span style={{ color: "#b45309" }}> · 🗝️ Key transferred</span>}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column",
                          alignItems: "flex-end", gap: "8px", flexShrink: 0 }}>
                          {statusBadge(trade.status)}
                          {trade.status === "pending" && (
                            <button onClick={() => cancelOffer(trade)} style={{
                              padding: "4px 10px", borderRadius: "6px",
                              border: "1px solid #fecaca", background: "#fef2f2",
                              color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                              fontSize: "16px", fontWeight: 600, cursor: "pointer",
                            }}>Cancel</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })()}

        {/* ── Schedule Walk ── */}
        {tab === "schedulewalk" && (
          <ScheduleWalkForm
            clients={clients}
            setClients={setClients}
            defaultWalker={walker.name}
            doneLabel="View My Schedule →"
            onDone={() => setTab("mywalks")}
            walkerProfiles={walkerProfiles}
            clientFilter={c => c.keyholder === walker.name}
            hideWalker
          />
        )}

        {/* ── Team Chat ── */}
        {tab === "chat" && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "14px" }}>Messages</div>

            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: "14px" }}>
              <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)",
                fontSize: "16px", pointerEvents: "none" }}>🔍</span>
              <input
                value={walkerMsgsSearch}
                onChange={e => setWalkerMsgsSearch(e.target.value)}
                placeholder="Search messages…"
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px",
                  borderRadius: "10px", border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", color: "#111827", background: "#fff", outline: "none" }}
              />
              {walkerMsgsSearch && (
                <button onClick={() => setWalkerMsgsSearch("")} style={{ position: "absolute", right: "10px",
                  top: "50%", transform: "translateY(-50%)", background: "none", border: "none",
                  cursor: "pointer", color: "#9ca3af", fontSize: "16px" }}>✕</button>
              )}
            </div>

            {/* Sub-tab pills */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
              {[{ id: "team", label: "Team" }, { id: "direct", label: "Direct" }, { id: "clients", label: "Clients" }].map(st => {
                const badge = st.id === "clients" ? unreadClientMsgCount : 0;
                return (
                  <button key={st.id} onClick={() => { setMsgSubTab(st.id); if (st.id === "team") setDmThread(null); }}
                    style={{ padding: "8px 18px", borderRadius: "20px", cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: msgSubTab === st.id ? 700 : 400,
                      border: `1.5px solid ${msgSubTab === st.id ? accentBlue : "#e4e7ec"}`,
                      background: msgSubTab === st.id ? accentBlue : "#fff",
                      color: msgSubTab === st.id ? "#fff" : "#6b7280", transition: "all 0.12s",
                      display: "flex", alignItems: "center", gap: "6px" }}>
                    {st.label}
                    {badge > 0 && (
                      <span style={{ background: "#ef4444", color: "#fff", borderRadius: "10px",
                        fontSize: "13px", fontWeight: 700, padding: "1px 6px", lineHeight: "16px" }}>{badge}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Team Messages ── */}
            {msgSubTab === "team" && (
              <>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280", marginBottom: "14px" }}>
                  Visible to the whole team.
                </p>
                <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px", overflow: "hidden" }}>
                  <div ref={chatContainerRef} style={{ padding: "16px 18px", height: "420px", overflowY: "auto",
                    display: "flex", flexDirection: "column", gap: "14px" }}>
                    {chatLoading && chatMessages.length === 0 ? (
                      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>Loading messages…</div>
                    ) : chatMessages.length === 0 ? (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                        <span style={{ fontSize: "32px" }}>💬</span>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>No messages yet. Say hello!</div>
                      </div>
                    ) : (
                      <>
                        {chatMessages.filter(msg => !walkerMsgsSearch || msg.text.toLowerCase().includes(walkerMsgsSearch.toLowerCase()) || msg.from.toLowerCase().includes(walkerMsgsSearch.toLowerCase())).map(msg => {
                          const isMine = msg.from === walker.name;
                          return (
                            <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: isMine ? "flex-end" : "flex-start" }}>
                              {!isMine && <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af", marginBottom: "4px", fontWeight: 600 }}>{msg.from}</div>}
                              <div style={{ padding: "10px 14px", borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                                background: isMine ? accentBlue : "#f3f4f6", color: isMine ? "#fff" : "#111827",
                                fontFamily: "'DM Sans', sans-serif", fontSize: "15px", maxWidth: "80%", lineHeight: "1.5" }}>{msg.text}</div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#d1d5db", marginTop: "3px" }}>{msg.time}</div>
                            </div>
                          );
                        })}
                        <div ref={chatBottomRef} />
                      </>
                    )}
                  </div>
                  <div style={{ padding: "12px 16px", borderTop: "1px solid #f3f4f6", display: "flex", gap: "8px" }}>
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && sendChat()}
                      placeholder="Type a message…"
                      style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={sendChat} style={{ padding: "10px 18px", borderRadius: "10px", border: "none",
                      background: accentBlue, color: "#fff", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>Send</button>
                  </div>
                </div>
              </>
            )}

            {/* ── Direct Messages ── */}
            {msgSubTab === "direct" && (() => {
              const otherWalkers = getAllWalkers(walkerProfiles).filter(w => w.name !== walker.name);

              // Thread view
              if (dmThread) {
                const threadWalker = otherWalkers.find(w => w.name === dmThread) || { name: dmThread, avatar: "🐾" };
                return (
                  <>
                    <button onClick={() => setDmThread(null)} style={{ background: "none", border: "none",
                      color: "#6b7280", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                      ← Back to Direct Messages
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                      <span style={{ fontSize: "24px" }}>{threadWalker.avatar}</span>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                        fontSize: "16px", color: "#111827" }}>{dmThread}</div>
                    </div>
                    <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px", overflow: "hidden" }}>
                      <div ref={dmContainerRef} style={{ padding: "16px 18px", height: "400px", overflowY: "auto",
                        display: "flex", flexDirection: "column", gap: "14px" }}>
                        {dmLoading && dmMessages.length === 0 ? (
                          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>Loading…</div>
                        ) : dmMessages.length === 0 ? (
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                            <span style={{ fontSize: "32px" }}>👋</span>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                              No messages yet. Start the conversation!
                            </div>
                          </div>
                        ) : (
                          <>
                            {dmMessages.filter(msg => !walkerMsgsSearch || msg.text.toLowerCase().includes(walkerMsgsSearch.toLowerCase()) || msg.from.toLowerCase().includes(walkerMsgsSearch.toLowerCase())).map(msg => {
                              const isMine = msg.from === walker.name;
                              return (
                                <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: isMine ? "flex-end" : "flex-start" }}>
                                  <div style={{ padding: "10px 14px", borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                                    background: isMine ? accentBlue : "#f3f4f6", color: isMine ? "#fff" : "#111827",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px", maxWidth: "80%", lineHeight: "1.5" }}>{msg.text}</div>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#d1d5db", marginTop: "3px" }}>{msg.time}</div>
                                </div>
                              );
                            })}
                            <div ref={dmBottomRef} />
                          </>
                        )}
                      </div>
                      <div style={{ padding: "12px 16px", borderTop: "1px solid #f3f4f6", display: "flex", gap: "8px" }}>
                        <input value={dmInput} onChange={e => setDmInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && sendDm()}
                          placeholder={`Message ${dmThread}…`}
                          style={{ ...inputStyle, flex: 1 }} />
                        <button onClick={sendDm} style={{ padding: "10px 18px", borderRadius: "10px", border: "none",
                          background: accentBlue, color: "#fff", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>Send</button>
                      </div>
                    </div>
                  </>
                );
              }

              // Walker list view
              return (
                <>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280", marginBottom: "14px" }}>
                    Send a private message to another walker.
                  </p>
                  {otherWalkers.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff",
                      borderRadius: "16px", border: "1.5px solid #e4e7ec" }}>
                      <div style={{ fontSize: "36px", marginBottom: "12px" }}>👥</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>No other walkers yet.</div>
                    </div>
                  ) : otherWalkers.map(w => (
                    <button key={w.id} onClick={() => setDmThread(w.name)}
                      style={{ width: "100%", background: "#fff", border: "1.5px solid #e4e7ec",
                        borderRadius: "14px", padding: "14px 18px", marginBottom: "10px",
                        cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: "14px" }}>
                      <span style={{ fontSize: "28px", flexShrink: 0 }}>{w.avatar}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "16px", color: "#111827" }}>{w.name}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                          {(w.role || "Walker").replace(/ & /g, " / ")}
                        </div>
                      </div>
                      <span style={{ color: "#d1d5db", fontSize: "18px" }}>›</span>
                    </button>
                  ))}
                </>
              );
            })()}

            {/* ── Client Messages ── */}
            {msgSubTab === "clients" && (() => {
              const msgs = selectedClientMsgEmail ? (clientMsgsByEmail[selectedClientMsgEmail] || []) : [];
              const selectedClientObj = selectedClientMsgEmail ? Object.values(clients).find(c => c.email === selectedClientMsgEmail) : null;
              return (
                <>
                  {myKeyClients.length === 0 ? (
                    <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px",
                      padding: "40px", textAlign: "center" }}>
                      <div style={{ fontSize: "32px", marginBottom: "10px" }}>💬</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#9ca3af", fontSize: "15px" }}>
                        You don't have any key clients yet.
                      </div>
                    </div>
                  ) : !selectedClientMsgEmail ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {myKeyClients.filter(c => !walkerMsgsSearch || c.name.toLowerCase().includes(walkerMsgsSearch.toLowerCase())).map(c => {
                        const convoMsgs = clientMsgsByEmail[c.email] || [];
                        const lastMsg   = convoMsgs[convoMsgs.length - 1];
                        const lastSeen  = clientMsgSeenMap[c.email] ? new Date(clientMsgSeenMap[c.email]) : null;
                        const unread    = convoMsgs.filter(m => m.from !== walker.name && m.sentAt && (!lastSeen || new Date(m.sentAt) > lastSeen)).length;
                        return (
                          <button key={c.email} onClick={() => setSelectedClientMsgEmail(c.email)}
                            className="hover-card"
                            style={{ width: "100%", background: "#fff",
                              border: unread > 0 ? "1.5px solid #8B5E3C" : "1.5px solid #e4e7ec",
                              borderRadius: "14px", padding: "14px 16px", cursor: "pointer",
                              textAlign: "left", display: "flex", alignItems: "center", gap: "14px" }}>
                            <div style={{ width: "44px", height: "44px", borderRadius: "50%",
                              background: unread > 0 ? "#C4541A" : "#f3f4f6",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "20px", flexShrink: 0 }}>🐾</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                fontSize: "16px", color: "#111827", marginBottom: "2px" }}>{c.name}</div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                                color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {lastMsg ? `${lastMsg.from === walker.name ? "You: " : ""}${lastMsg.text}` : "No messages yet"}
                              </div>
                            </div>
                            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                              {unread > 0 && (
                                <span style={{ background: "#ef4444", color: "#fff", borderRadius: "10px",
                                  fontSize: "13px", fontWeight: 700, padding: "1px 7px", lineHeight: "16px",
                                  minWidth: "16px", textAlign: "center" }}>{unread}</span>
                              )}
                              {lastMsg && <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#d1d5db" }}>{lastMsg.time}</div>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div>
                      <button onClick={() => setSelectedClientMsgEmail(null)} style={{
                        background: "none", border: "none", color: "#6b7280", cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px", marginBottom: "12px",
                        display: "flex", alignItems: "center", gap: "6px", padding: 0 }}>
                        ← Back to Clients
                      </button>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                        fontSize: "15px", color: "#111827", marginBottom: "12px" }}>
                        {selectedClientObj?.name || selectedClientMsgEmail}
                      </div>
                      <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px", overflow: "hidden" }}>
                        <div ref={clientMsgContainerRef}
                          style={{ padding: "16px 18px", height: "420px", overflowY: "auto",
                            display: "flex", flexDirection: "column", gap: "14px" }}>
                          {clientMsgLoading && msgs.length === 0 ? (
                            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>Loading messages…</div>
                          ) : msgs.length === 0 ? (
                            <div style={{ flex: 1, display: "flex", flexDirection: "column",
                              alignItems: "center", justifyContent: "center", gap: "8px" }}>
                              <span style={{ fontSize: "32px" }}>💬</span>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                color: "#9ca3af", textAlign: "center" }}>No messages yet. Say hello to {selectedClientObj?.name}!</div>
                            </div>
                          ) : (
                            <>
                              {msgs.filter(msg => !walkerMsgsSearch || msg.text.toLowerCase().includes(walkerMsgsSearch.toLowerCase()) || msg.from.toLowerCase().includes(walkerMsgsSearch.toLowerCase())).map(msg => {
                                const isMine = msg.from === walker.name;
                                return (
                                  <div key={msg.id} style={{ display: "flex", flexDirection: "column",
                                    alignItems: isMine ? "flex-end" : "flex-start" }}>
                                    {!isMine && <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                      color: "#9ca3af", marginBottom: "4px", fontWeight: 600 }}>{msg.from}</div>}
                                    <div style={{ padding: "10px 14px",
                                      borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                                      background: isMine ? accentBlue : "#f3f4f6",
                                      color: isMine ? "#fff" : "#111827",
                                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                      maxWidth: "80%", lineHeight: "1.5" }}>{msg.text}</div>
                                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                                      color: "#d1d5db", marginTop: "3px" }}>{msg.time}</div>
                                  </div>
                                );
                              })}
                              <div ref={clientMsgBottomRef} />
                            </>
                          )}
                        </div>
                        <div style={{ padding: "12px 16px", borderTop: "1px solid #f3f4f6", display: "flex", gap: "8px" }}>
                          <input value={clientMsgInput} onChange={e => setClientMsgInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && sendWalkerMsg()}
                            placeholder={`Message ${selectedClientObj?.name || "client"}…`}
                            style={{ flex: 1, padding: "10px 14px", borderRadius: "10px",
                              border: "1.5px solid #e4e7ec", background: "#fff",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#111827", outline: "none" }} />
                          <button onClick={sendWalkerMsg} style={{ padding: "10px 18px", borderRadius: "10px", border: "none",
                            background: accentBlue, color: "#fff", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>Send</button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
        {tab === "myclients" && (() => {
          const myClients = Object.values(clients).filter(c => c.keyholder === walker.name);
          return (
            <div className="fade-up">
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#111827", marginBottom: "4px" }}>My Clients</div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
                marginBottom: "16px", lineHeight: "1.5" }}>
                You hold the key for {myClients.length} client{myClients.length !== 1 ? "s" : ""}. Update their info, pets, or notes anytime.
              </p>

              {/* ── Add Client Banner ── */}
              {!showAddClient ? (
                <button
                  onClick={() => setShowAddClient(true)}
                  style={{
                    width: "100%", marginBottom: "20px",
                    background: `linear-gradient(135deg, ${accentBlue}0d, ${accentBlue}18)`,
                    border: `1.5px dashed ${accentBlue}55`,
                    borderRadius: "14px", padding: "16px 20px",
                    display: "flex", alignItems: "center", gap: "14px",
                    cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                  }}
                  className="hover-card"
                >
                  <div style={{ width: "40px", height: "40px", borderRadius: "50%", flexShrink: 0,
                    background: accentBlue, display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: "18px" }}>➕</div>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                      fontSize: "16px", color: accentBlue }}>Add a New Client</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#6b7280", marginTop: "2px" }}>
                      They'll be added under your name as keyholder
                    </div>
                  </div>
                </button>
              ) : (
                <div className="fade-up" style={{ marginBottom: "20px", background: "#fff",
                  border: `2px solid ${accentBlue}`, borderRadius: "16px", overflow: "hidden",
                  boxShadow: `0 4px 20px ${accentBlue}14` }}>
                  <div style={{ padding: "14px 18px", background: `${accentBlue}08`,
                    borderBottom: `1px solid ${accentBlue}18`,
                    display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                      fontSize: "16px", color: accentBlue }}>➕ Add New Client</div>
                    <button onClick={() => setShowAddClient(false)}
                      style={{ background: "none", border: "none", cursor: "pointer",
                        fontSize: "18px", color: "#9ca3af", lineHeight: 1, padding: "2px" }}>✕</button>
                  </div>
                  <div style={{ padding: "4px 0" }}>
                    <AddLegacyClientForm
                      clients={clients}
                      setClients={setClients}
                      onDone={() => setShowAddClient(false)}
                      walkerProfiles={walkerProfiles}
                      lockedWalker={walker.name}
                    />
                  </div>
                </div>
              )}

              {/* ── Client List ── */}
              {myClients.length === 0 && !showAddClient ? (
                <div style={{ background: "#fff", borderRadius: "16px", padding: "48px 24px",
                  textAlign: "center", border: "1.5px solid #e4e7ec" }}>
                  <div style={{ fontSize: "36px", marginBottom: "12px" }}>🗝️</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#6b7280", marginBottom: "6px" }}>No keyholder clients yet.</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#d1d5db" }}>
                    Use the button above to add your first client.
                  </div>
                </div>
              ) : myClients.map(c => (
                <WalkerClientEditor key={c.id} client={c} clients={clients} setClients={setClients} accentBlue={accentBlue} />
              ))}
            </div>
          );
        })()}

        {/* ── My Info ── */}
        {tab === "myinfo" && (() => {
          const PREF_DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

          const handleSaveInfo = () => {
            if (!setWalkerProfiles) return;
            const updated = {
              ...(walkerProfiles || {}),
              [walker.id]: {
                ...((walkerProfiles || {})[walker.id] || {}),
                ...infoForm,
                address: addrToString(infoForm.addrObj),
              },
            };
            setWalkerProfiles(updated);
            setInfoSaved(true);
            setInfoEditing(false);
            setTimeout(() => setInfoSaved(false), 2000);
          };

          const toggleDay = (day) => {
            setInfoForm(prev => ({
              ...prev,
              preferredDays: prev.preferredDays.includes(day)
                ? prev.preferredDays.filter(d => d !== day)
                : [...prev.preferredDays, day],
            }));
          };

          const fieldStyle = {
            width: "100%", padding: "11px 14px", borderRadius: "10px",
            border: "1.5px solid #C8E4E8", background: infoEditing ? "#fff" : "#f9fafb",
            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            color: "#111827", outline: "none",
            transition: "border-color 0.15s, background 0.15s",
            pointerEvents: infoEditing ? "auto" : "none",
          };

          const labelStyle = {
            display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
            color: "#4E7A8C", marginBottom: "6px",
          };

          return (
            <div className="fade-up">
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start",
                justifyContent: "space-between", marginBottom: "20px", gap: "12px" }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "#111827", marginBottom: "4px" }}>My Info</div>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#6b7280", lineHeight: "1.5" }}>
                    Your profile is visible to the admin. Keep it up to date so they can reach you.
                  </p>
                </div>
                {!infoEditing ? (
                  <button onClick={() => setInfoEditing(true)} style={{
                    padding: "8px 18px", borderRadius: "9px", border: `1.5px solid ${accentBlue}44`,
                    background: `${accentBlue}10`, color: accentBlue, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    fontWeight: 600, flexShrink: 0,
                  }}>✏️ Edit</button>
                ) : (
                  <div style={{ display: "flex", gap: "7px", flexShrink: 0 }}>
                    <button onClick={handleSaveInfo} style={{
                      padding: "8px 18px", borderRadius: "9px", border: "none",
                      background: "#059669", color: "#fff", cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600,
                    }}>✓ Save</button>
                    <button onClick={() => { setInfoEditing(false); setInfoForm({
                      preferredName: myProfile.preferredName || walker.name || "",
                      email: myProfile.email || walker.email || "",
                      phone: myProfile.phone || "",
                      address: myProfile.address || "",
                      addrObj: myProfile.addrObj || addrFromString(myProfile.address || ""),
                      preferredAvailability: myProfile.preferredAvailability || "",
                      preferredDays: myProfile.preferredDays || [],
                      notes: myProfile.notes || "",
                      pendingBio: myProfile.pendingBio || "",
                      services: myProfile.services || [],
                    }); }} style={{
                      padding: "8px 14px", borderRadius: "9px",
                      border: "1.5px solid #e4e7ec", background: "#fff",
                      color: "#6b7280", cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    }}>Cancel</button>
                  </div>
                )}
              </div>

              {/* Saved confirmation */}
              {infoSaved && (
                <div style={{ background: "#FDF5EC", border: "1.5px solid #EDD5A8",
                  borderRadius: "12px", padding: "12px 16px", marginBottom: "16px",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 600, color: "#059669", display: "flex", alignItems: "center", gap: "8px" }}>
                  ✓ Profile saved! Admin can now see your updated info.
                </div>
              )}

              {/* Identity */}
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "14px", padding: "20px", marginBottom: "12px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                  fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                  color: "#9ca3af", marginBottom: "16px" }}>Identity</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                  <div>
                    <label style={labelStyle}>Preferred Name</label>
                    <input
                      value={infoForm.preferredName}
                      onChange={e => setInfoForm(f => ({ ...f, preferredName: e.target.value }))}
                      placeholder={walker.name}
                      style={fieldStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Email Address</label>
                    <input
                      type="email"
                      value={infoForm.email}
                      onChange={e => setInfoForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="your@email.com"
                      style={fieldStyle}
                    />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Phone Number</label>
                  <input
                    type="tel"
                    value={infoForm.phone}
                    onChange={e => setInfoForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
                    placeholder="214.555.0000"
                    maxLength={12}
                    style={fieldStyle}
                  />
                </div>
              </div>

              {/* Location */}
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "14px", padding: "20px", marginBottom: "12px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                  fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                  color: "#9ca3af", marginBottom: "16px" }}>Location</div>
                <label style={labelStyle}>Home Address</label>
                <AddressFields
                  value={infoForm.addrObj}
                  onChange={(obj, str) => setInfoForm(f => ({ ...f, addrObj: obj, address: str }))}
                  inputBaseStyle={{
                    padding: "10px 13px", fontSize: "15px",
                    pointerEvents: infoEditing ? "auto" : "none",
                    background: infoEditing ? "#fff" : "#f9fafb",
                  }}
                  labelBaseStyle={{ fontSize: "16px", color: "#9ca3af" }}
                />
              </div>

              {/* Availability Preferences */}
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "14px", padding: "20px", marginBottom: "12px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                  fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                  color: "#9ca3af", marginBottom: "16px" }}>Availability Preferences</div>

                {/* Preferred days */}
                <label style={{ ...labelStyle, marginBottom: "10px" }}>Preferred Days</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "16px" }}>
                  {PREF_DAYS.map(day => {
                    const active = infoForm.preferredDays.includes(day);
                    return (
                      <button key={day}
                        onClick={() => infoEditing && toggleDay(day)}
                        style={{
                          padding: "6px 14px", borderRadius: "8px", fontSize: "16px",
                          fontFamily: "'DM Sans', sans-serif", cursor: infoEditing ? "pointer" : "default",
                          border: active ? `1.5px solid ${accentBlue}` : "1.5px solid #C8E4E8",
                          background: active ? `${accentBlue}15` : infoEditing ? "#f9fafb" : "#f3f4f6",
                          color: active ? accentBlue : "#9ca3af",
                          fontWeight: active ? 600 : 400, transition: "all 0.12s",
                        }}>
                        {day.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>

                {/* Free-text availability note */}
                <label style={labelStyle}>Availability Notes</label>
                <textarea
                  value={infoForm.preferredAvailability}
                  onChange={e => setInfoForm(f => ({ ...f, preferredAvailability: e.target.value }))}
                  placeholder="e.g. Available Mon–Fri 8am–6pm, occasional weekend mornings"
                  rows={3}
                  style={{
                    ...fieldStyle,
                    resize: "vertical",
                    lineHeight: "1.6",
                    pointerEvents: infoEditing ? "auto" : "none",
                  }}
                />
              </div>

              {/* Additional Notes */}
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "14px", padding: "20px", marginBottom: "12px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                  fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                  color: "#9ca3af", marginBottom: "16px" }}>Additional Notes</div>
                <label style={labelStyle}>Notes for Admin</label>
                <textarea
                  value={infoForm.notes}
                  onChange={e => setInfoForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Anything else the admin should know — schedule constraints, certifications, etc."
                  rows={4}
                  style={{
                    ...fieldStyle,
                    resize: "vertical",
                    lineHeight: "1.6",
                    pointerEvents: infoEditing ? "auto" : "none",
                  }}
                />
              </div>

              {/* Services Offered */}
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "14px", padding: "20px", marginBottom: "12px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                  fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                  color: "#9ca3af", marginBottom: "14px" }}>Services Offered</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {WALKER_SERVICES.map(svc => {
                    const active = infoForm.services.includes(svc.id);
                    return (
                      <button key={svc.id}
                        disabled={!infoEditing}
                        onClick={() => infoEditing && setInfoForm(f => ({
                          ...f,
                          services: active
                            ? f.services.filter(s => s !== svc.id)
                            : [...f.services, svc.id],
                        }))}
                        style={{
                          display: "flex", alignItems: "center", gap: "12px",
                          padding: "11px 14px", borderRadius: "10px", textAlign: "left",
                          border: `1.5px solid ${active ? svc.border : "#e4e7ec"}`,
                          background: active ? svc.bg : infoEditing ? "#fff" : "#f9fafb",
                          cursor: infoEditing ? "pointer" : "default",
                          transition: "all 0.12s", width: "100%",
                        }}>
                        <span style={{ fontSize: "18px" }}>{svc.icon}</span>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: active ? 600 : 400,
                          color: active ? svc.color : "#6b7280", flex: 1 }}>
                          {svc.label}
                        </span>
                        {active && (
                          <span style={{ fontSize: "15px", fontWeight: 700,
                            color: svc.color, background: svc.border + "80",
                            borderRadius: "4px", padding: "1px 7px" }}>✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {!infoEditing && infoForm.services.length === 0 && (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#9ca3af", fontStyle: "italic", marginTop: "8px" }}>
                    Click Edit to select your services.
                  </div>
                )}
              </div>

              {/* Bio */}
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "14px", padding: "20px", marginBottom: "12px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                  fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                  color: "#9ca3af", marginBottom: "6px" }}>Bio</div>

                {/* Published bio status */}
                {myProfile.bio && (
                  <div style={{ background: "#FDF5EC", border: "1px solid #EDD5A8",
                    borderRadius: "8px", padding: "10px 14px", marginBottom: "12px",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#059669" }}>
                    ✓ Published bio is live on your profile
                  </div>
                )}
                {myProfile.pendingBio && myProfile.pendingBio !== myProfile.bio && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fde68a",
                    borderRadius: "8px", padding: "10px 14px", marginBottom: "12px",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#92400e" }}>
                    ⏳ Your bio update is awaiting admin approval
                  </div>
                )}

                <label style={labelStyle}>Your Bio</label>
                <textarea
                  value={infoForm.pendingBio}
                  onChange={e => setInfoForm(f => ({ ...f, pendingBio: e.target.value }))}
                  placeholder="Tell clients a little about yourself — your experience, your approach with animals, what you love about dog walking…"
                  rows={4}
                  style={{ ...fieldStyle, resize: "vertical", lineHeight: "1.6", pointerEvents: infoEditing ? "auto" : "none" }}
                />
                {infoEditing && (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#9ca3af", marginTop: "6px", lineHeight: "1.5" }}>
                    Your bio will appear on the team page once an admin approves it.
                  </div>
                )}
              </div>

              {/* Change PIN */}
              {(() => {
                const myCredEmail = (myProfile.email || walker.email || "").toLowerCase();
                const myCred = myCredEmail ? WALKER_CREDENTIALS[myCredEmail] : null;

                const handlePinSave = () => {
                  const errs = {};
                  if (!myCred || currentPin !== myCred.pin) errs.current = "Current PIN is incorrect.";
                  if (!/^\d{4}$/.test(newPinVal))           errs.new = "New PIN must be exactly 4 digits.";
                  if (newPinVal !== confirmPin)              errs.confirm = "PINs don't match.";
                  if (newPinVal === currentPin && !errs.current) errs.new = "New PIN must be different from your current PIN.";
                  if (Object.keys(errs).length) { setPinErrors(errs); return; }

                  if (myCred) WALKER_CREDENTIALS[myCredEmail] = { ...myCred, pin: newPinVal };
                  if (setWalkerProfiles) {
                    const updated = {
                      ...(walkerProfiles || {}),
                      [walker.id]: { ...((walkerProfiles || {})[walker.id] || {}), pin: newPinVal },
                    };
                    setWalkerProfiles(updated);
                  }
                  setPinStage("success");
                  setCurrentPin(""); setNewPinVal(""); setConfirmPin(""); setPinErrors({});
                  setTimeout(() => setPinStage("idle"), 3000);
                };

                const pinFieldStyle = (err) => ({
                  width: "100%", padding: "12px 14px", borderRadius: "10px",
                  border: `1.5px solid ${err ? "#ef4444" : "#C8E4E8"}`,
                  background: "#fff", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "22px", letterSpacing: "8px", color: "#111827",
                  outline: "none", boxSizing: "border-box",
                });

                return (
                  <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                    borderRadius: "14px", padding: "20px", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center",
                      justifyContent: "space-between", marginBottom: pinStage !== "idle" ? "16px" : 0 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                        fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                        color: "#9ca3af" }}>Change PIN</div>
                      {pinStage === "idle" && (
                        <button onClick={() => { setPinStage("form"); setPinErrors({}); }}
                          style={{ padding: "7px 16px", borderRadius: "8px",
                            border: `1.5px solid ${accentBlue}44`,
                            background: `${accentBlue}10`, color: accentBlue,
                            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 600, cursor: "pointer" }}>
                          Change
                        </button>
                      )}
                    </div>

                    {pinStage === "form" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                        <div>
                          <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", fontWeight: 700, letterSpacing: "1.5px",
                            textTransform: "uppercase", color: accentBlue, marginBottom: "6px" }}>
                            Current PIN
                          </label>
                          <input type="password" inputMode="numeric" maxLength={4}
                            placeholder="••••" value={currentPin}
                            onChange={e => { setCurrentPin(e.target.value.replace(/\D/g, "")); setPinErrors(p => ({ ...p, current: "" })); }}
                            style={pinFieldStyle(pinErrors.current)} />
                          {pinErrors.current && <div style={{ color: "#ef4444",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "14px", marginTop: "4px" }}>{pinErrors.current}</div>}
                        </div>
                        <div>
                          <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", fontWeight: 700, letterSpacing: "1.5px",
                            textTransform: "uppercase", color: accentBlue, marginBottom: "6px" }}>
                            New PIN
                          </label>
                          <input type="password" inputMode="numeric" maxLength={4}
                            placeholder="••••" value={newPinVal}
                            onChange={e => { setNewPinVal(e.target.value.replace(/\D/g, "")); setPinErrors(p => ({ ...p, new: "" })); }}
                            style={pinFieldStyle(pinErrors.new)} />
                          {pinErrors.new && <div style={{ color: "#ef4444",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "14px", marginTop: "4px" }}>{pinErrors.new}</div>}
                        </div>
                        <div>
                          <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", fontWeight: 700, letterSpacing: "1.5px",
                            textTransform: "uppercase", color: accentBlue, marginBottom: "6px" }}>
                            Confirm New PIN
                          </label>
                          <input type="password" inputMode="numeric" maxLength={4}
                            placeholder="••••" value={confirmPin}
                            onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, "")); setPinErrors(p => ({ ...p, confirm: "" })); }}
                            style={pinFieldStyle(pinErrors.confirm)} />
                          {pinErrors.confirm && <div style={{ color: "#ef4444",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "14px", marginTop: "4px" }}>{pinErrors.confirm}</div>}
                        </div>
                        <div style={{ display: "flex", gap: "10px" }}>
                          <button onClick={handlePinSave}
                            disabled={currentPin.length < 4 || newPinVal.length < 4 || confirmPin.length < 4}
                            style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none",
                              background: (currentPin.length < 4 || newPinVal.length < 4 || confirmPin.length < 4)
                                ? "#e4e7ec" : accentBlue,
                              color: (currentPin.length < 4 || newPinVal.length < 4 || confirmPin.length < 4)
                                ? "#9ca3af" : "#fff",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 600, cursor: "pointer" }}>
                            Update PIN
                          </button>
                          <button onClick={() => { setPinStage("idle"); setCurrentPin(""); setNewPinVal(""); setConfirmPin(""); setPinErrors({}); }}
                            style={{ padding: "12px 18px", borderRadius: "10px",
                              border: "1.5px solid #e4e7ec", background: "#f9fafb",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#374151", cursor: "pointer" }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {pinStage === "success" && (
                      <div style={{ color: "#059669", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", fontWeight: 600 }}>
                        ✓ PIN updated successfully
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Save button at bottom when editing */}
              {infoEditing && (
                <button onClick={handleSaveInfo} style={{
                  width: "100%", padding: "15px", borderRadius: "12px",
                  border: "none", background: accentBlue, color: "#fff",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                  fontWeight: 500, cursor: "pointer", marginTop: "4px",
                }}>
                  Save Profile ✓
                </button>
              )}

            </div>
          );
        })()}

        {tab === "invoices" && (() => {
          const myInvoices = myKeyClients.flatMap(c =>
            (c.invoices || []).map(inv => ({
              ...inv,
              clientName: c.name,
              clientEmail: c.email,
            }))
          ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

          const filtered = invFilter === "all" ? myInvoices : myInvoices.filter(inv => {
            const { effectiveStatus } = invoiceStatusMeta(inv.status, inv.dueDate);
            return effectiveStatus === invFilter;
          });

          const pendingCount   = myInvoices.filter(inv => invoiceStatusMeta(inv.status, inv.dueDate).effectiveStatus === "sent").length;
          const overdueCount   = myInvoices.filter(inv => invoiceStatusMeta(inv.status, inv.dueDate).effectiveStatus === "overdue").length;
          const paidCount      = myInvoices.filter(inv => inv.status === "paid").length;
          const outstandingAmt = myInvoices.filter(inv => inv.status === "sent").reduce((s, inv) => s + (inv.total || 0), 0);
          const accentBlue     = "#3D6B7A";

          return (
            <div className="fade-up">
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
                Client Invoices
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#6b7280", marginBottom: "20px" }}>
                Read-only view of invoices for your key clients.
              </p>

              {/* KPI row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
                gap: "10px", marginBottom: "20px" }}>
                {[
                  { label: "Outstanding", value: fmt(outstandingAmt, true), color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
                  { label: "Overdue",     value: overdueCount,         color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
                  { label: "Paid",        value: paidCount,            color: "#059669", bg: "#f0fdf4", border: "#a8d5bf" },
                ].map(k => (
                  <div key={k.label} style={{ background: k.bg, border: `1.5px solid ${k.border}`,
                    borderRadius: "12px", padding: "14px 16px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                      textTransform: "uppercase", letterSpacing: "1px",
                      fontWeight: 700, color: k.color, marginBottom: "4px" }}>{k.label}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "22px",
                      fontWeight: 700, color: "#111827" }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Filter chips */}
              <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
                {[
                  { id: "all",     label: "All" },
                  { id: "sent",    label: "Pending" },
                  { id: "overdue", label: "Overdue" },
                  { id: "paid",    label: "Paid" },
                ].map(f => (
                  <button key={f.id} onClick={() => setInvFilter(f.id)} style={{
                    padding: "6px 14px", borderRadius: "20px", cursor: "pointer",
                    border: `1.5px solid ${invFilter === f.id ? accentBlue : "#e4e7ec"}`,
                    background: invFilter === f.id ? accentBlue : "#fff",
                    color: invFilter === f.id ? "#fff" : "#6b7280",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                    fontWeight: invFilter === f.id ? 600 : 400,
                  }}>{f.label}</button>
                ))}
              </div>

              {/* Invoice list */}
              {filtered.length === 0 ? (
                <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                  borderRadius: "14px", padding: "36px", textAlign: "center" }}>
                  <div style={{ fontSize: "28px", marginBottom: "10px" }}>🧾</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 600, color: "#374151", marginBottom: "4px" }}>No invoices found</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                    {myKeyClients.length === 0
                      ? "You have no key clients assigned yet."
                      : "No invoices match this filter."}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {filtered.map(inv => {
                    const meta = invoiceStatusMeta(inv.status, inv.dueDate);
                    const isOpen = expandedWalkKey === `inv_${inv.id}`;
                    return (
                      <div key={inv.id} style={{ background: "#fff",
                        border: isOpen ? `2px solid ${accentBlue}` : "1.5px solid #e4e7ec",
                        borderRadius: "14px", overflow: "hidden",
                        boxShadow: isOpen ? `0 4px 16px ${accentBlue}14` : "none",
                        transition: "all 0.15s" }}>
                        {/* Header row — tap to expand */}
                        <button onClick={() => setExpandedWalkKey(isOpen ? null : `inv_${inv.id}`)}
                          style={{ width: "100%", background: "none", border: "none",
                            cursor: "pointer", padding: "16px 18px", textAlign: "left" }}>
                          <div style={{ display: "flex", alignItems: "flex-start",
                            justifyContent: "space-between", gap: "12px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center",
                                gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                                <span style={{ fontFamily: "'DM Sans', sans-serif",
                                  fontWeight: 700, fontSize: "15px", color: "#111827" }}>
                                  {inv.clientName}
                                </span>
                                <span style={{ fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "12px", fontWeight: 700, color: meta.color,
                                  background: meta.bg, border: `1px solid ${meta.border}`,
                                  borderRadius: "5px", padding: "1px 8px" }}>
                                  {meta.label}
                                </span>
                                {inv.autoGenerated && (
                                  <span style={{ fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "12px", color: "#9ca3af", background: "#f3f4f6",
                                    borderRadius: "5px", padding: "1px 7px" }}>Auto</span>
                                )}
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "13px", color: "#9ca3af" }}>
                                {inv.items?.length || 0} walk{(inv.items?.length || 0) !== 1 ? "s" : ""}
                                {inv.dueDate && inv.status === "sent"
                                  ? ` · Due ${new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                                  : ""}
                                {inv.paidAt
                                  ? ` · Paid ${new Date(inv.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                                  : ""}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "18px", fontWeight: 700,
                                color: meta.effectiveStatus === "paid" ? "#059669" : "#111827" }}>
                                ${inv.total}
                              </div>
                              {inv.gratuity > 0 && (
                                <div style={{ fontSize: "12px", fontWeight: 600, color: "#C4541A",
                                  background: "#FDF5EC", border: "1px solid #D4A87A",
                                  borderRadius: "6px", padding: "2px 6px", whiteSpace: "nowrap" }}>
                                  +${Number(inv.gratuity).toFixed(2)} tip
                                </div>
                              )}
                              <span style={{ color: "#9ca3af", fontSize: "13px",
                                transform: isOpen ? "rotate(180deg)" : "none",
                                display: "inline-block", transition: "transform 0.15s" }}>▾</span>
                            </div>
                          </div>
                        </button>
                        {/* Expanded detail */}
                        {isOpen && (
                          <div style={{ borderTop: `1px solid ${accentBlue}22`,
                            padding: "14px 18px", background: `${accentBlue}06` }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                              fontWeight: 700, color: "#9ca3af", textTransform: "uppercase",
                              letterSpacing: "0.8px", marginBottom: "8px" }}>Walk Items</div>
                            {(inv.items || []).map((it, i) => (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between",
                                alignItems: "center", padding: "7px 0",
                                borderBottom: i < (inv.items.length - 1) ? "1px solid #f3f4f6" : "none",
                                fontFamily: "'DM Sans', sans-serif" }}>
                                <div style={{ fontSize: "14px", color: "#374151", flex: 1, minWidth: 0 }}>
                                  {it.description}
                                </div>
                                {it.amount != null && (
                                  <div style={{ fontSize: "14px", fontWeight: 600,
                                    color: "#111827", flexShrink: 0, marginLeft: "12px" }}>
                                    ${it.amount}
                                  </div>
                                )}
                              </div>
                            ))}
                            <div style={{ borderTop: "2px solid #e4e7ec", paddingTop: "10px",
                              marginTop: "4px", display: "flex", flexDirection: "column", gap: "6px",
                              fontFamily: "'DM Sans', sans-serif" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                                <span style={{ color: "#9ca3af" }}>Walk Total</span>
                                <span style={{ fontWeight: 600, color: "#111827" }}>${inv.total}</span>
                              </div>
                              {inv.gratuity > 0 && (
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                                  <span style={{ color: "#C4541A", fontWeight: 500 }}>Gratuity (to walker)</span>
                                  <span style={{ fontWeight: 600, color: "#C4541A" }}>+${Number(inv.gratuity).toFixed(2)}</span>
                                </div>
                              )}
                              <div style={{ display: "flex", justifyContent: "space-between",
                                borderTop: "1px solid #e4e7ec", paddingTop: "6px", fontSize: "15px", fontWeight: 700 }}>
                                <span style={{ color: "#9ca3af" }}>Total</span>
                                <span style={{ color: meta.effectiveStatus === "paid" ? "#059669" : "#111827" }}>
                                  ${(inv.total + (inv.gratuity || 0)).toFixed(2)}
                                </span>
                              </div>
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif",
                              fontSize: "12px", color: "#9ca3af", marginTop: "8px" }}>
                              {inv.id}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}


      </div>
      </div>{/* end scrollable content */}
    </div>
  );
}

export default WalkerDashboard;
