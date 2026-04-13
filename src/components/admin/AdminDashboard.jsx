import { useState, useEffect, useRef, useMemo } from "react";
import { SERVICES, SERVICE_SLOTS, DAYS, FULL_DAYS, WALKER_SERVICES } from "../../constants.js";
import {
  saveClients, saveWalkerProfiles, deleteWalkerFromDB, notifyAdmin, saveTrades,
  loadChatMessages, saveChatMessage, formatChatTime,
  loadDirectMessages, saveDirectMessage,
  loadWalkerAvailability, saveWalkerAvailabilityDay,
  loadCompletedPayrolls, saveCompletedPayrolls,
  loadAllWalkersAvailability,
  updateInvoiceInDB,
  loadContactSubmissions,
  logAuditEvent,
  createWalkerAuthAccount, inviteWalkerAuth,
} from "../../supabase.js";
import {
  effectivePrice, getWalkerPayout,
  PUNCH_CARD_GOAL,
  getCurrentWeekRange, getWeekRangeForOffset,
  getBookingWeekKey, getWeekBookingCountForOffset,
  getSessionPrice, getCancellationPolicy,
  repriceWeekBookings,
  revokePunchCard, fulfillPunchCardClaim,
  getWeekDates, firstName, parseDateLocal, dateStrFromDate,
  fmt, formatPhone, addrToString, addrFromString, emptyAddr,
} from "../../helpers.js";
import LogoBadge from "../shared/LogoBadge.jsx";
import AddressFields from "../shared/AddressFields.jsx";
import ScheduleWalkForm from "./ScheduleWalkForm.jsx";
import AddLegacyClientForm from "./AddLegacyClientForm.jsx";
import AdminMapView from "./AdminMapView.jsx";
import AdminInvoicesTab from "./AdminInvoicesTab.jsx";
import AdminAdminsTab from "./AdminAdminsTab.jsx";
import AdminMyInfo from "./AdminMyInfo.jsx";
import AdminContactTab from "./AdminContactTab.jsx";
import AdminAuditTab from "./AdminAuditTab.jsx";
import { generateInvoiceId, getAllInvoices, invoiceStatusMeta } from "../invoices/invoiceHelpers.js";
import { generateRecurringBookings, extendRecurringBookings, spawnNextRecurringOccurrence } from "../recurring.js";
import { GLOBAL_STYLES } from "../../styles.js";
import { WALKER_CREDENTIALS, getAllWalkers, injectCustomWalkers } from "../auth/WalkerAuthScreen.jsx";
import Header from "../shared/Header.jsx";
import { SUPABASE_ANON_KEY, SUPABASE_URL, loadClients, loadTrades, loadWalkerProfiles, sendWalkerCancellationNotification, sendClientCancellationNotification } from "../../supabase.js";

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
function AdminDashboard({ admin, setAdmin, clients, setClients, walkerProfiles, setWalkerProfiles, trades, setTrades, adminList, setAdminList, onLogout }) {
  const [tab, setTab] = useState("overview");
  const [bookingsView, setBookingsView] = useState("upcoming"); // "upcoming" | "completed"
  const [invoicesKey, setInvoicesKey] = useState(0); // increments to remount AdminInvoicesTab on nav
  const [clientSearch, setClientSearch] = useState("");
  const [walkerSearch, setWalkerSearch] = useState("");
  const [appSearch,    setAppSearch]    = useState("");
  const [bookingSearch,setBookingSearch]= useState("");
  const [assignSearch,  setAssignSearch]  = useState("");
  const [assignDateFilter, setAssignDateFilter] = useState("");
  const [pings, setPings] = useState({}); // { [walkerId]: { at: Date, adminName: string } }

  // Send a ping to a walker (internal now; wire Twilio here later)
  const sendPing = (walkerId, walkerName, walkerPhone) => {
    setPings(prev => ({ ...prev, [walkerId]: { at: new Date(), adminName: admin.name || "Admin" } }));
    // TODO: replace with Twilio SMS when ready
    // await fetch("/api/ping-walker", { method: "POST",
    //   body: JSON.stringify({ walkerId, walkerName, walkerPhone, adminName: admin.name }) });
    // console.log(`[PING] ${walkerName} pinged by ${admin.name}`); // re-enable for local debug
  };

  // Reset all expanded/selected/drill-down state when switching tabs
  const changeTab = (newTab) => {
    setTab(newTab);
    setSelectedWalkerId(null);
    setSelectedClientId(null);
    setExpandedKpi(null);
    setExpandedBooking(null);
    setExpandedClient(null);
    setExpandedWalkKey(null);
    setWalkEditDraft(null);
    setConfirmDeleteWalkKey(null);
    setOvwExpandedWalkKey(null);
    setOvwWalkEditDraft(null);
    setOvwConfirmDeleteWalkKey(null);
    setEditingWalker(null);
    setEditingBookingKey(null);
    setEditDraft(null);
    setShowAddWalker(false);
    setShowAdminAddClient(false);
    setSelectedApp(null);
    setConfirmDeleteWalkerId(null);
    setConfirmDeleteClientId(null);
    setClientEditMode(false);
    setClientEditDraft(null);
    setConfirmPayrollWalker(null);
    setBookingsView("upcoming");
    if (newTab === "invoices") setInvoicesKey(k => k + 1);
    if (newTab === "contact") {
      try { localStorage.setItem(CONTACT_SEEN_KEY, new Date().toISOString()); } catch {}
      setNewContactCount(0);
    }
    setClientSearch(""); setWalkerSearch(""); setAppSearch(""); setBookingSearch("");
    setAssignSearch(""); setAssignDateFilter("");
  };
  // ── Contact notification badge ──
  const [newContactCount, setNewContactCount] = useState(0);
  const CONTACT_SEEN_KEY = "lsb_contact_last_seen";

  useEffect(() => {
    (async () => {
      try {
        const subs = await loadContactSubmissions();
        const lastSeen = (() => { try { return localStorage.getItem(CONTACT_SEEN_KEY) || ""; } catch { return ""; } })();
        if (lastSeen) {
          const unseenCount = subs.filter(s => s.createdAt && new Date(s.createdAt) > new Date(lastSeen)).length;
          setNewContactCount(unseenCount);
        } else {
          // Never opened contact tab — all "new" status submissions are unseen
          setNewContactCount(subs.filter(s => s.status === "new").length);
        }
      } catch (e) {
        console.error("Failed to load contact count:", e);
      }
    })();
  }, [tab]); // re-check when switching tabs (in case new ones came in)

  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [expandedKpi, setExpandedKpi] = useState(null);
  const [kpiWalkDetail, setKpiWalkDetail] = useState(null);
  const [expandedBooking, setExpandedBooking] = useState(null);
  const [completingKey, setCompletingKey] = useState(null);
  const [undoingKey, setUndoingKey] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);
  const [earlyAckKey, setEarlyAckKey] = useState(null);
  const [editingBookingKey, setEditingBookingKey] = useState(null);
  const [editDraft, setEditDraft] = useState(null); // { date, timeSlot, walker }
  const [editingHandoffKey, setEditingHandoffKey] = useState(null);
  const [editHandoffDraft, setEditHandoffDraft] = useState(null); // { date, time, walker }
  const [deletingHandoffKey, setDeletingHandoffKey] = useState(null);
  const [expandedClient, setExpandedClient] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [selectedWalkerId, setSelectedWalkerId] = useState(null);
  const [editingWalker, setEditingWalker] = useState(null); // draft edits
  const [showAddWalker, setShowAddWalker] = useState(false);
  const [showApplications, setShowApplications] = useState(false);
  const [applications, setApplications] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  const [walkerForm, setWalkerForm] = useState({ name: "", email: "", years: "", bio: "", avatar: "🐾", color: "#C4541A", services: [] });
  const [walkerFormErrors, setWalkerFormErrors] = useState({});
  const [confirmDeleteWalkerId, setConfirmDeleteWalkerId] = useState(null);
  const [walkerStatView, setWalkerStatView] = useState(null); // null | "upcoming" | "completed" | "earnings"
  const [clientSortKey, setClientSortKey] = useState("firstName");
  const [clientSortDir, setClientSortDir] = useState("asc");
  const [expandedPayrollWalkers, setExpandedPayrollWalkers] = useState(new Set());
  const [payrollWeekOffset, setPayrollWeekOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDeleteClientId, setConfirmDeleteClientId] = useState(null);
  const [mapGeoCache, setMapGeoCache] = useState({});
  const [clientEditMode, setClientEditMode] = useState(false);
  const [clientEditDraft, setClientEditDraft] = useState(null);
  const [showAdminAddClient, setShowAdminAddClient] = useState(false);
  const [expandedWalkKey, setExpandedWalkKey] = useState(null);
  const [walkEditDraft, setWalkEditDraft] = useState(null);
  const [confirmDeleteWalkKey, setConfirmDeleteWalkKey] = useState(null);
  const [ovwExpandedWalkKey, setOvwExpandedWalkKey] = useState(null);
  const [ovwWalkEditDraft, setOvwWalkEditDraft] = useState(null);
  const [ovwConfirmDeleteWalkKey, setOvwConfirmDeleteWalkKey] = useState(null);
  const [completedPayrolls, setCompletedPayrolls] = useState([]);
  const [payrollStale, setPayrollStale] = useState(false);
  const [payrollSaveError, setPayrollSaveError] = useState("");
  const [confirmPayrollWalker, setConfirmPayrollWalker] = useState(null); // walkerName awaiting confirm

  // ── Team Chat ───────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLastSeenAt, setChatLastSeenAt] = useState(() => {
    try { return localStorage.getItem("dwi_chat_seen_admin") || ""; } catch { return ""; }
  });
  const chatPollRef = useRef(null);
  const chatBottomRef = useRef(null);
  const chatContainerRef = useRef(null);

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
      try { localStorage.setItem("dwi_chat_seen_admin", now); } catch {}
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

  useEffect(() => {
    const el = chatContainerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  const sendAdminChat = async () => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput("");
    const tempMsg = { id: `tmp-${Date.now()}`, from: "Admin", text, sentAt: new Date().toISOString(), time: "Just now" };
    setChatMessages(m => [...m, tempMsg]);
    await saveChatMessage("Admin", text);
    loadChatMessages().then(setChatMessages);
  };

  const unreadChatCount = chatLastSeenAt
    ? chatMessages.filter(m => m.from !== "Admin" && m.sentAt && new Date(m.sentAt) > new Date(chatLastSeenAt)).length
    : 0;

  useEffect(() => {
    loadCompletedPayrolls().then(result => {
      if (result && result.stale) {
        setCompletedPayrolls(result.records || []);
        setPayrollStale(true);
      } else {
        setCompletedPayrolls(result || []);
        setPayrollStale(false);
      }
    });
  }, []);

  // ── Notification / last-seen tracking ──────────────────────────────────────
  const [seenTs, setSeenTs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("dwi_admin_seen_v1") || "{}"); } catch { return {}; }
  });
  // Whenever the admin navigates to a tab, stamp it as "seen now"
  useEffect(() => {
    setSeenTs(prev => {
      const updated = { ...prev, [`${tab}At`]: new Date().toISOString() };
      localStorage.setItem("dwi_admin_seen_v1", JSON.stringify(updated));
      return updated;
    });
  }, [tab]);

  // Flatten all bookings — split into active, admin-completed, and stripe-paid
  const allBookings = [];
  const completedBookings = []; // admin-marked complete (old invoice flow)
  const stripePaidBookings = []; // paid upfront via Stripe (new flow)
  // Use PIN (map key) as clientId so admin actions (delete/edit) can look up clients[clientId]
  Object.entries(clients).forEach(([pin, c]) => {
    (c.bookings || []).forEach(b => {
      if (b.cancelled) return;
      if (b.adminCompleted) {
        completedBookings.push({ ...b, clientId: pin, clientName: c.name, clientEmail: c.email, clientKeyholder: c.keyholder || "" });
      } else {
        if (c.deleted) return;
        allBookings.push({ ...b, clientId: pin, clientName: c.name, clientEmail: c.email, clientKeyholder: c.keyholder || "" });
        if (b.status === "confirmed" && b.stripeSessionId && b.paidAt) {
          stripePaidBookings.push({ ...b, clientId: pin, clientName: c.name, clientEmail: c.email });
        }
      }
    });
  });

  const markCompleted = (booking) => {
    const clientId = booking.clientId;
    const c = clients[clientId];
    if (!c) return;
    const completedAt = new Date().toISOString();

    // Mark the booking complete
    let updatedBookings = c.bookings.map(b =>
      b.key === booking.key
        ? { ...b, adminCompleted: true, completedAt }
        : b
    );

    // If recurring, spawn the next occurrence so the series continues indefinitely
    if (booking.isRecurring) {
      const updatedClient = { ...c, bookings: updatedBookings };
      const next = spawnNextRecurringOccurrence(updatedClient, booking);
      if (next) {
        updatedBookings = repriceWeekBookings([...updatedBookings, next]);
      }
    }

    // Punch card punches are awarded at payment time (Stripe return), not on walk completion.
    const updatedClients = { ...clients, [clientId]: { ...c, bookings: updatedBookings } };
    setClients(updatedClients);
    saveClients(updatedClients);
    notifyAdmin("walk_completed", {
      clientName: booking.clientName || c.name,
      pet: booking.form?.pet || "Pet",
      walker: booking.form?.walker || "Unknown",
      date: booking.date,
      price: effectivePrice(booking),
    });
    logAuditEvent({ adminId: admin.id, adminName: admin.name, action: "walk_completed",
      entityType: "booking", entityId: booking.key,
      details: { clientName: booking.clientName || c.name, walkerName: booking.form?.walker,
        pet: booking.form?.pet, date: booking.date, amount: effectivePrice(booking) } });
    setCompletingKey(null);
    setExpandedBooking(null);
  };

  const undoCompletion = (booking) => {
    const clientId = booking.clientId || Object.keys(clients).find(cid =>
      (clients[cid].bookings || []).some(bk => bk.key === booking.key)
    );
    if (!clientId || !clients[clientId]) return;
    const c = clients[clientId];
    const updatedBookings = c.bookings.map(b =>
      b.key === booking.key
        ? { ...b, adminCompleted: false, completedAt: undefined, walkerMarkedComplete: false }
        : b
    );
    // Punch card punches are NOT revoked on undo-complete — they were earned at payment time.
    // Punches are only revoked if the booking is cancelled.
    const updatedClients = { ...clients, [clientId]: { ...c, bookings: updatedBookings } };
    setClients(updatedClients);
    saveClients(updatedClients);
    logAuditEvent({ adminId: admin.id, adminName: admin.name, action: "walk_uncompleted",
      entityType: "booking", entityId: booking.key,
      details: { clientName: booking.clientName, walkerName: booking.form?.walker,
        pet: booking.form?.pet, date: booking.date } });
    setUndoingKey(null);
  };

  const now = new Date();

  // Inject pending meet & greet appointments from handoffInfo into upcoming
  const handoffBookings = [];
  Object.entries(clients).forEach(([pin, c]) => {
    if (c.deleted || c.handoffConfirmed) return;
    const hi = c.handoffInfo;
    if (!hi?.handoffDate || !hi?.handoffSlot) return;
    const apptDate = new Date(hi.handoffDate);
    if (apptDate <= now) return;
    handoffBookings.push({
      key: `__handoff__${c.id}`,
      isHandoff: true,
      service: "handoff",
      clientId: pin,
      clientName: c.name,
      clientEmail: c.email,
      day: apptDate.toLocaleDateString("en-US", { weekday: "long" }),
      date: apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      slot: { time: hi.handoffSlot.time, duration: "15 min" },
      form: { walker: hi.handoffWalker || "", pet: "", name: c.name || "" },
      bookedAt: hi.handoffDate,
      scheduledDateTime: hi.handoffDate,
      price: 0, priceTier: "",
    });
  });

  const upcoming = [
    ...allBookings.filter(b => new Date(b.scheduledDateTime || b.bookedAt) > now),
    ...handoffBookings,
  ];
  const unassigned = upcoming.filter(b => !b.form?.walker || b.form.walker === "");

  // Revenue: admin-completed walks + Stripe-paid confirmed bookings
  const { monday: wMon } = getCurrentWeekRange();
  const totalRevenue = completedBookings.reduce((s, b) => s + effectivePrice(b), 0)
    + stripePaidBookings.reduce((s, b) => s + effectivePrice(b), 0);
  const weekRevenue = completedBookings
    .filter(b => new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) >= wMon)
    .reduce((s, b) => s + effectivePrice(b), 0)
    + stripePaidBookings
    .filter(b => new Date(b.paidAt) >= wMon)
    .reduce((s, b) => s + effectivePrice(b), 0);

  // Profit: revenue minus walker payout (flat rates per duration/tier)
  const totalWalkerPayout = completedBookings.reduce((s, b) => s + getWalkerPayout(b), 0);
  const weekWalkerPayout = completedBookings
    .filter(b => new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) >= wMon)
    .reduce((s, b) => s + getWalkerPayout(b), 0);
  const totalProfit = totalRevenue - totalWalkerPayout;
  const weekProfit = weekRevenue - weekWalkerPayout;

  // Pipeline: expected revenue & profit from all upcoming uncompleted walks
  const pipelineRevenue = upcoming.filter(b => !b.isOvernight).reduce((s, b) => s + effectivePrice(b), 0);
  const pipelineWalkerPayout = upcoming.filter(b => !b.isOvernight).reduce((s, b) => s + getWalkerPayout(b), 0);
  const pipelineProfit = pipelineRevenue - pipelineWalkerPayout;

  // Group completed walks by client, sorted most recent first within each
  const completedByClient = {};
  completedBookings.forEach(b => {
    const key = b.clientName || b.clientEmail || "Unknown";
    if (!completedByClient[key]) completedByClient[key] = [];
    completedByClient[key].push(b);
  });
  Object.keys(completedByClient).forEach(k => {
    completedByClient[k].sort((a, b) =>
      new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) -
      new Date(a.completedAt || a.scheduledDateTime || a.bookedAt)
    );
  });
  const sortedClientNames = Object.keys(completedByClient).sort();

  // ── Per-tab notification badge counts ─────────────────────────────────────
  // clients: new non-deleted clients registered since admin last visited the Clients tab
  const clientsAt = seenTs.clientsAt ? new Date(seenTs.clientsAt) : null;
  const newClientsCount = clientsAt
    ? Object.values(clients).filter(c => !c.deleted && c.createdAt && new Date(c.createdAt) > clientsAt).length
    : 0;
  // bookings: walker-confirmed walks awaiting admin mark-complete (always actionable)
  const pendingWalkerConfirms = allBookings.filter(b => b.walkerMarkedComplete && !b.adminCompleted).length;
  // assign: upcoming walks with no walker assigned yet
  const unassignedCount = unassigned.length;
  // applications: pending job applications
  const pendingAppsCount = applications.filter(a => a.status === "pending").length;

  const notifCounts = {
    clients:      newClientsCount,
    bookings:     pendingWalkerConfirms,
    assign:       unassignedCount,
    applications: pendingAppsCount,
    chat:         unreadChatCount,
    invoices:     getAllInvoices(clients).filter(inv => {
      const { effectiveStatus } = invoiceStatusMeta(inv.status, inv.dueDate);
      return effectiveStatus === "overdue";
    }).length,
    contact:      newContactCount,
  };

  const TABS = [
    { id: "overview",      label: "Dashboard",       icon: "📊" },
    { id: "dailies",       label: "Dailies",         icon: "📋" },
    { id: "bookings",      label: "All Bookings",   icon: "📅" },
    { id: "clients",       label: "Clients",        icon: "👥" },
    { id: "walkers",       label: "Walkers",        icon: "🦺" },
    { id: "applications",  label: "Applications",   icon: "📝" },
    { id: "assign",        label: "Assign Walks",   icon: "📌" },
    { id: "schedulewalk",  label: "Schedule Walk",  icon: "📆" },
    { id: "invoices",      label: "Financials",     icon: "🧾" },
    { id: "payroll",       label: "Payroll",        icon: "💵" },
    { id: "chat",          label: "Team Chat",      icon: "💬" },
    { id: "map",           label: "Map",            icon: "🗺️" },
    { id: "admins",        label: "Admins",         icon: "🛡️" },
    { id: "myinfo",        label: "My Info",        icon: "👤" },
    { id: "contact",       label: "Contact",        icon: "📨" },
    { id: "audit",         label: "Audit Log",      icon: "🕵️" },
  ];

  const amber = "#b45309";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#faf8f5" }}>
      <style>{GLOBAL_STYLES}</style>



      {/* Admin Hamburger Drawer */}      {adminMenuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
          <div onClick={() => setAdminMenuOpen(false)}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "280px",
            background: "#4D2E10", display: "flex", flexDirection: "column",
            boxShadow: "4px 0 24px rgba(0,0,0,0.35)", overflowY: "auto" }}>
            <div style={{ padding: "24px 20px 16px", borderBottom: "1px solid #6B4420",
              display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <LogoBadge size={28} />
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                    fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600 }}>Lonestar Bark Co.</div>
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#d97706",
                  fontSize: "15px", marginTop: "2px" }}>🛡️ Admin Dashboard</div>
              </div>
              <button onClick={() => setAdminMenuOpen(false)} style={{ background: "none",
                border: "none", color: "#d97706", fontSize: "22px", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, padding: "12px 0" }}>
              {TABS.map(t => {
                const badgeCount = notifCounts[t.id] || 0;
                return (
                  <button key={t.id} onClick={() => { changeTab(t.id); setAdminMenuOpen(false); }} style={{
                    width: "100%", padding: "13px 20px", border: "none",
                    display: "flex", alignItems: "center", gap: "14px", cursor: "pointer",
                    borderLeft: tab === t.id ? `3px solid ${amber}` : "3px solid transparent",
                    background: tab === t.id ? "rgba(180,83,9,0.15)" : "transparent",
                  }}>
                    <span style={{ fontSize: "18px", width: "24px", textAlign: "center" }}>{t.icon}</span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      fontWeight: tab === t.id ? 600 : 400,
                      color: tab === t.id ? "#fff" : "rgba(255,255,255,0.65)", flex: 1 }}>{t.label}</span>
                    {badgeCount > 0 && (
                      <span style={{ background: "#ef4444", color: "#fff", borderRadius: "10px",
                        fontSize: "16px", fontWeight: 700, padding: "1px 6px",
                        minWidth: "16px", textAlign: "center", display: "inline-block" }}>
                        {badgeCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: "16px 20px", borderTop: "1px solid #6B4420" }}>
              <button onClick={onLogout} style={{ width: "100%", padding: "11px",
                borderRadius: "10px", border: "1px solid #8B5220", background: "transparent",
                color: "#d97706", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                cursor: "pointer" }}>Log out</button>
            </div>
          </div>
        </div>
      )}

      <div data-scroll-pane style={{ flex: 1, overflowY: "scroll", WebkitOverflowScrolling: "touch" }}>
      {/* Header */}
      <header style={{ background: "#4D2E10", padding: "16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "15px", textTransform: "uppercase", fontWeight: 600, letterSpacing: "1px", display: "flex", alignItems: "center", gap: "10px" }}>
              Lonestar Bark Co.
              {(() => {
                const total = Object.values(notifCounts).reduce((s, n) => s + n, 0);
                return total > 0 ? (
                  <span style={{
                    background: "#ef4444", color: "#fff", borderRadius: "12px",
                    fontSize: "15px", fontWeight: 700, padding: "2px 8px", lineHeight: "18px",
                    minWidth: "20px", textAlign: "center", display: "inline-block",
                    boxShadow: "0 0 0 2px #4D2E10",
                  }}>{total}</span>
                ) : null;
              })()}
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#d97706",
              fontSize: "16px", marginTop: "2px" }}>
              🛡️ Admin · {TABS.find(t => t.id === tab)?.label || ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={async () => {
                setRefreshing(true);
                try {
                  const [c, wp, tr, pr] = await Promise.all([
                    loadClients(), loadWalkerProfiles(), loadTrades(), loadCompletedPayrolls(),
                  ]);
                  injectCustomWalkers(wp);
                  const extended = extendRecurringBookings(c);
                  if (extended !== c) saveClients(extended);
                  setClients(extended);
                  setWalkerProfiles(wp);
                  setTrades(tr);
                  if (pr && pr.stale) {
                    setCompletedPayrolls(pr.records || []);
                    setPayrollStale(true);
                  } else {
                    setCompletedPayrolls(pr || []);
                    setPayrollStale(false);
                  }
                } finally {
                  setRefreshing(false);
                }
              }}
              disabled={refreshing}
              title="Refresh data from server"
              data-tooltip="Refresh data"
              style={{
                background: "transparent", border: "1px solid #8B5220",
                color: refreshing ? "#8B5220" : "#d97706",
                padding: "8px 12px", borderRadius: "8px", cursor: refreshing ? "default" : "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                lineHeight: 1, transition: "color 0.15s",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: refreshing ? "spin 0.8s linear infinite" : "none",
              }}>↻</button>
            <button onClick={() => setAdminMenuOpen(true)} style={{ background: "transparent",
              border: "1px solid #8B5220", color: "#d97706", padding: "8px 12px",
              borderRadius: "8px", cursor: "pointer",
              display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
              <span style={{ display: "block", width: "18px", height: "2px", background: "#d97706", borderRadius: "2px" }} />
              <span style={{ display: "block", width: "18px", height: "2px", background: "#d97706", borderRadius: "2px" }} />
              <span style={{ display: "block", width: "18px", height: "2px", background: "#d97706", borderRadius: "2px" }} />
            </button>
          </div>
        </div>
      </header>
      {/* Sliding Tab Nav — sticky inside scroll pane */}
      <nav style={{ background: "#4D2E10", borderBottom: "1px solid #6B4420",
        display: "flex", alignItems: "stretch",
        position: "sticky", top: 0, zIndex: 10 }}
        className="nav-tabs sticky-nav">
        {/* ── Pinned: Overview ── */}
        {(() => {
          const t = TABS[0];
          return (
            <button key={t.id} onClick={() => { changeTab(t.id); document.querySelector('[data-scroll-pane]')?.scrollTo({ top: 0, behavior: 'instant' }); }} style={{
              padding: "10px 14px", border: "none", whiteSpace: "nowrap",
              background: "transparent", flexShrink: 0,
              borderBottom: tab === t.id ? `3px solid ${amber}` : "3px solid transparent",
              borderRight: "1px solid #6B4420",
              color: tab === t.id ? "#fff" : "rgba(255,255,255,0.65)",
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
            const badgeCount = notifCounts[t.id] || 0;
            return (
              <button key={t.id} onClick={() => { changeTab(t.id); document.querySelector('[data-scroll-pane]')?.scrollTo({ top: 0, behavior: 'instant' }); }} style={{
                padding: "10px 14px", border: "none", whiteSpace: "nowrap", background: "transparent",
                borderBottom: tab === t.id ? `3px solid ${amber}` : "3px solid transparent",
                color: tab === t.id ? "#fff" : "rgba(255,255,255,0.65)",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                fontWeight: tab === t.id ? 600 : 400,
                cursor: "pointer", transition: "color 0.15s, border-color 0.15s",
                display: "flex", alignItems: "center", gap: "5px", flexShrink: 0,
                position: "relative",
              }}>
                <span style={{ fontSize: "15px" }}>{t.icon}</span> {t.label}
                {badgeCount > 0 && (
                  <span style={{ background: "#ef4444", color: "#fff", borderRadius: "10px",
                    fontSize: "16px", fontWeight: 700, padding: "1px 6px", lineHeight: "16px",
                    minWidth: "16px", textAlign: "center", display: "inline-block" }}>
                    {badgeCount}
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
      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "24px 16px 80px" }}>

        {/* ── Overview ── */}
        {tab === "overview" && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "20px" }}>Dashboard</div>


            {/* ── KPI Cards ── */}
            {(() => {
              const todayStr = new Date().toDateString();
              const todayBookings = allBookings.filter(b =>
                new Date(b.scheduledDateTime || b.bookedAt).toDateString() === todayStr
              ).sort((a, b) => new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt));

              // Daily confirmation counts (all clients, today's upcoming walks)
              const allTodayScheduled = (() => {
                const arr = [];
                Object.values(clients).forEach(c => {
                  (c.bookings || []).forEach(b => {
                    if (b.cancelled || b.adminCompleted) return;
                    if (new Date(b.scheduledDateTime || b.bookedAt).toDateString() === todayStr)
                      arr.push(b);
                  });
                });
                return arr;
              })();
              const todayConfirmedCount = allTodayScheduled.filter(b => b.walkerConfirmed).length;
              const todayTotalCount     = allTodayScheduled.length;

              const weekCompletedList = completedBookings
                .filter(b => new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) >= wMon)
                .sort((a, b) => new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) - new Date(a.completedAt || a.scheduledDateTime || a.bookedAt));

              const upcomingList = upcoming
                .slice()
                .sort((a, b) => new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt));

              const completedList = completedBookings
                .slice()
                .sort((a, b) => new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) - new Date(a.completedAt || a.scheduledDateTime || a.bookedAt));

              const walkerProfitRows = (bookingSet) => {
                const byWalker = {};
                bookingSet.forEach(b => {
                  const name = b.form?.walker || "Unassigned";
                  if (!byWalker[name]) byWalker[name] = { revenue: 0, payout: 0, count: 0 };
                  byWalker[name].revenue += effectivePrice(b);
                  byWalker[name].payout += getWalkerPayout(b);
                  byWalker[name].count += 1;
                });
                return Object.entries(byWalker).sort((a, b) => b[1].revenue - a[1].revenue).map(([name, d]) => ({
                  name,
                  revenue: d.revenue,
                  payout: Math.round(d.payout),
                  profit: Math.round(d.revenue - d.payout),
                  count: d.count,
                  walker: getAllWalkers(walkerProfiles).find(w => w.name === name),
                }));
              };

              const clientList = Object.entries(clients)
                .filter(([, c]) => !c.deleted)
                .map(([pin, c]) => {
                  const activeCount = (c.bookings || []).filter(b => !b.cancelled && !b.adminCompleted).length;
                  const completedCount = (c.bookings || []).filter(b => b.adminCompleted).length;
                  const totalSpend = (c.bookings || []).filter(b => b.adminCompleted).reduce((s, b) => s + effectivePrice(b), 0).toFixed(2);
                  return { c, pin, activeCount, completedCount, totalSpend };
                })
                .sort((a, b) => parseFloat(b.totalSpend) - parseFloat(a.totalSpend));

              const kpis = [
                { id: "weekRev",        label: "Week's Revenue",    value: fmt(weekRevenue, true),          icon: "📅", color: amber,     note: "completed" },
                { id: "allRev",         label: "All-Time Revenue",  value: fmt(totalRevenue, true),         icon: "💰", color: "#7A4D6E", note: "completed" },
                { id: "profit",         label: "All-Time Profit",   value: fmt(totalProfit, true),          icon: "📈", color: "#059669", note: "lifetime",   detail: `This week: ${fmt(weekProfit, true)}` },
                { id: "dailyConfirm",   label: "Today's Walks",     value: `${todayConfirmedCount}/${todayTotalCount}`, icon: "✅", color: todayTotalCount > 0 && todayConfirmedCount === todayTotalCount ? "#059669" : "#C4541A", note: "confirmed",  detail: todayTotalCount === 0 ? "no walks today" : todayConfirmedCount === todayTotalCount ? "all confirmed!" : `${todayTotalCount - todayConfirmedCount} remaining` },
                { id: "clients",        label: "Total Clients",     value: Object.keys(clients).length, icon: "👥", color: "#C4541A" },
                { id: "activeBook",     label: "Active Bookings",   value: allBookings.length,           icon: "📋", color: "#3D6B7A" },
                { id: "pipelineRev",    label: "Pipeline Revenue",  value: fmt(pipelineRevenue, true),        icon: "🔮", color: "#7A4D6E", note: "upcoming", detail: `${upcoming.filter(b => !b.isOvernight).length} walks` },
                { id: "uninvoiced",     label: "Uninvoiced Walks",  value: (() => { const cnt = Object.values(clients).filter(c => !c.deleted).reduce((s, c) => { const ik = new Set((c.invoices||[]).filter(i=>i.status!=="draft").flatMap(i=>(i.items||[]).map(it=>it.bookingKey))); return s + (c.bookings||[]).filter(b=>b.adminCompleted&&!b.cancelled&&!ik.has(b.key)).length; }, 0); return cnt; })(), icon: "📬", color: "#3D6B7A", note: "pending" },
                { id: "upcoming",       label: "Upcoming Walks",    value: upcoming.length,              icon: "🐕", color: "#C4541A" },
                { id: "completed",      label: "Completed Walks",   value: completedBookings.length,     icon: "✅", color: "#059669" },
              ];

              const drawerContent = (id) => {
                const rowStyle = { padding: "10px 0", borderBottom: "1px solid #f3f4f6",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#374151" };
                const emptyStyle = { fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                  color: "#9ca3af", fontStyle: "italic", padding: "10px 0", textAlign: "center" };

                if (id === "clients") return (
                  <div>
                    {clientList.length === 0 ? <div style={emptyStyle}>No clients yet.</div> : clientList.map((item, i) => (
                      <div key={i} onClick={() => { changeTab("clients"); setSelectedClientId(item.pin); setExpandedKpi(null); }}
                        style={{ ...rowStyle, display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "50%",
                          background: "#8B5E3C18", display: "flex", alignItems: "center",
                          justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>🐾</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#111827", fontSize: "15px" }}>{item.c.name}</div>
                          <div style={{ fontSize: "15px", color: "#9ca3af", marginTop: "1px" }}>
                            {item.activeCount} active · {item.completedCount} completed
                          </div>
                          {(item.c.freeWalkClaims || []).some(cl => !cl.fulfilled) && (
                            <div style={{ display: "inline-block", marginTop: "3px",
                              background: "#fef2f2", border: "1px solid #fca5a5",
                              borderRadius: "4px", padding: "1px 6px",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                              fontWeight: 600, color: "#dc2626" }}>
                              🎉 Free walk claim pending
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, color: "#C4541A" }}>${item.totalSpend}</div>
                          {(item.c.punchCardCount || 0) > 0 && (
                            <div style={{ fontSize: "13px", color: "#b45309", fontWeight: 600 }}>
                              ⭐ {item.c.punchCardCount}/{PUNCH_CARD_GOAL}
                            </div>
                          )}
                          <div style={{ fontSize: "14px", color: "#C4541A" }}>→ account</div>
                        </div>
                      </div>
                    ))}
                  </div>
                );

                if (id === "activeBook") return (
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#9ca3af", marginBottom: "8px", fontWeight: 600,
                      textTransform: "uppercase", letterSpacing: "0.8px" }}>Today's Bookings</div>
                    {todayBookings.length === 0
                      ? <div style={emptyStyle}>No bookings scheduled for today.</div>
                      : todayBookings.map((b, i) => {
                          const isDetailOpen = kpiWalkDetail?.key === b.key;
                          return (
                            <div key={i}>
                              <div onClick={() => setKpiWalkDetail(isDetailOpen ? null : b)}
                                style={{ ...rowStyle, display: "flex", alignItems: "center", gap: "10px",
                                  cursor: "pointer", background: isDetailOpen ? "#f0fdf4" : "transparent",
                                  margin: "0 -16px", padding: "10px 16px", transition: "background 0.15s" }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 600, color: "#111827", fontSize: "15px" }}>
                                    {b.clientName} · {b.form?.pet || "Pet"}
                                  </div>
                                  <div style={{ fontSize: "14px", color: "#9ca3af", marginTop: "1px" }}>
                                    {new Date(b.scheduledDateTime || b.bookedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                    {b.form?.walker ? ` · ${b.form.walker}` : " · Unassigned"}
                                    {" · "}{b.slot?.duration || "30 min"}
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                                  {b.walkerConfirmed
                                    ? <span style={{ fontSize: "13px", background: "#FDF5EC", color: "#059669",
                                        border: "1px solid #EDD5A8", borderRadius: "4px", padding: "2px 6px", fontWeight: 600 }}>✓</span>
                                    : <span style={{ fontSize: "13px", background: "#fffbeb", color: "#92400e",
                                        border: "1px solid #fde68a", borderRadius: "4px", padding: "2px 6px", fontWeight: 600 }}>Pending</span>
                                  }
                                  <span style={{ color: "#d1d5db", fontSize: "12px" }}>{isDetailOpen ? "▲" : "▾"}</span>
                                </div>
                              </div>
                              {isDetailOpen && (
                                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0",
                                  borderRadius: "10px", padding: "12px 14px", margin: "0 0 8px",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                                    {[
                                      ["Client", b.clientName],
                                      ["Pet", b.form?.pet || "—"],
                                      ["Walker", b.form?.walker || "Unassigned"],
                                      ["Time", b.slot?.time || new Date(b.scheduledDateTime || b.bookedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })],
                                      ["Duration", b.slot?.duration || "30 min"],
                                      ["Status", b.walkerConfirmed ? "Confirmed" : "Pending"],
                                    ].map(([label, val]) => (
                                      <div key={label}>
                                        <div style={{ color: "#9ca3af", fontSize: "11px", fontWeight: 600,
                                          textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
                                        <div style={{ color: "#111827", fontWeight: 500, marginTop: "2px" }}>{val}</div>
                                      </div>
                                    ))}
                                  </div>
                                  <button onClick={e => { e.stopPropagation(); changeTab("clients"); setSelectedClientId(b.clientId); setExpandedKpi(null); }}
                                    style={{ fontSize: "13px", color: "#059669", background: "none", border: "none",
                                      cursor: "pointer", padding: 0, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
                                    → Open client account
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                  </div>
                );

                if (id === "weekRev") return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af",
                      textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 600, marginBottom: "8px" }}>
                      <span>Walk</span><span>Amount</span>
                    </div>
                    {weekCompletedList.length === 0
                      ? <div style={emptyStyle}>No completed walks this week.</div>
                      : weekCompletedList.map((b, i) => {
                          const isDetailOpen = kpiWalkDetail?.key === b.key;
                          return (
                            <div key={i}>
                              <div onClick={() => setKpiWalkDetail(isDetailOpen ? null : b)}
                                style={{ ...rowStyle, display: "flex", justifyContent: "space-between",
                                  alignItems: "center", cursor: "pointer",
                                  background: isDetailOpen ? "#fffbeb" : "transparent",
                                  margin: "0 -16px", padding: "10px 16px", transition: "background 0.15s" }}>
                                <div>
                                  <div style={{ fontWeight: 600, color: "#111827", fontSize: "15px" }}>
                                    {b.clientName} · {b.form?.pet || "Pet"}
                                  </div>
                                  <div style={{ fontSize: "14px", color: "#9ca3af" }}>
                                    {new Date(b.completedAt || b.scheduledDateTime || b.bookedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                    {b.form?.walker ? ` · ${b.form.walker}` : ""}
                                    {" · "}{b.slot?.duration || "30 min"}
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                    fontWeight: 600, color: amber }}>${effectivePrice(b)}</div>
                                  <span style={{ color: "#d1d5db", fontSize: "12px" }}>{isDetailOpen ? "▲" : "▾"}</span>
                                </div>
                              </div>
                              {isDetailOpen && (
                                <div style={{ background: "#fffbeb", border: "1px solid #fde68a",
                                  borderRadius: "10px", padding: "12px 14px", margin: "0 0 8px",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                    {[
                                      ["Client", b.clientName],
                                      ["Pet", b.form?.pet || "—"],
                                      ["Walker", b.form?.walker || "Unassigned"],
                                      ["Date", new Date(b.scheduledDateTime || b.bookedAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })],
                                      ["Time", b.slot?.time || "—"],
                                      ["Duration", b.slot?.duration || "30 min"],
                                      ["Service", b.service === "cat" ? "Cat-sitting" : b.isOvernight ? "Overnight" : "Dog walk"],
                                      ["Amount", `$${effectivePrice(b)}`],
                                    ].map(([label, val]) => (
                                      <div key={label}>
                                        <div style={{ color: "#9ca3af", fontSize: "11px", fontWeight: 600,
                                          textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
                                        <div style={{ color: "#111827", fontWeight: 500, marginTop: "2px" }}>{val}</div>
                                      </div>
                                    ))}
                                  </div>
                                  {b.form?.notes && (
                                    <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #fde68a" }}>
                                      <div style={{ color: "#9ca3af", fontSize: "11px", fontWeight: 600,
                                        textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "3px" }}>Notes</div>
                                      <div style={{ color: "#374151" }}>{b.form.notes}</div>
                                    </div>
                                  )}
                                  {b.walkPhotos?.length > 0 && (
                                    <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #fde68a" }}>
                                      <div style={{ color: "#9ca3af", fontSize: "11px", fontWeight: 600,
                                        textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "8px" }}>
                                        📸 Walk Photos ({b.walkPhotos.length})
                                      </div>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                        {b.walkPhotos.map((url, pi) => (
                                          <a key={pi} href={url} target="_blank" rel="noreferrer">
                                            <img src={url} alt={`Walk photo ${pi + 1}`}
                                              style={{ width: "72px", height: "72px", objectFit: "cover",
                                                borderRadius: "8px", border: "1.5px solid #fde68a",
                                                cursor: "pointer" }} />
                                          </a>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    <div style={{ display: "flex", justifyContent: "space-between",
                      padding: "10px 0 2px", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "16px", fontWeight: 700, color: "#111827", borderTop: "2px solid #f3f4f6", marginTop: "4px" }}>
                      <span>Total</span><span style={{ color: amber }}>${weekRevenue}</span>
                    </div>
                  </div>
                );

                if (id === "allRev") {
                  const topClients = clientList.filter(item => item.totalSpend > 0).slice(0, 8);
                  const walkerRows = walkerProfitRows(completedBookings);
                  return (
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af",
                        fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "8px" }}>Top Clients by Revenue</div>
                      {topClients.length === 0
                        ? <div style={emptyStyle}>No completed walks yet.</div>
                        : topClients.map((item, i) => (
                        <div key={i} onClick={() => { changeTab("clients"); setSelectedClientId(item.pin); setExpandedKpi(null); }}
                          style={{ ...rowStyle, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                          <div style={{ fontWeight: 500, color: "#111827" }}>{item.c.name}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 600, color: "#7A4D6E" }}>${item.totalSpend}</div>
                            <span style={{ fontSize: "12px", color: "#7A4D6E" }}>→</span>
                          </div>
                        </div>
                      ))}
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af",
                        fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px",
                        marginTop: "14px", marginBottom: "8px" }}>Revenue by Walker</div>
                      {walkerRows.length === 0
                        ? <div style={emptyStyle}>No data yet.</div>
                        : walkerRows.map((r, i) => (
                        <div key={i} onClick={() => { if (r.walker) { changeTab("walkers"); setSelectedWalkerId(r.walker.id); setExpandedKpi(null); } }}
                          style={{ ...rowStyle, display: "flex", justifyContent: "space-between", alignItems: "center",
                            cursor: r.walker ? "pointer" : "default" }}>
                          <div>
                            <span style={{ fontWeight: 500, color: "#111827" }}>{r.walker?.avatar || "🐾"} {r.name}</span>
                            <span style={{ color: "#9ca3af", marginLeft: "6px" }}>({r.count} walks)</span>
                            {r.walker && <span style={{ color: "#7A4D6E", fontSize: "12px", marginLeft: "6px" }}>→ profile</span>}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, color: "#7A4D6E" }}>${r.revenue}</div>
                        </div>
                      ))}
                    </div>
                  );
                }

                if (id === "profit") {
                  return (
                    <div>
                      {/* Week vs Lifetime summary rows */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "14px" }}>
                        {[
                          { label: "This Week", rev: weekRevenue, payout: weekWalkerPayout, profit: weekProfit, color: "#b45309" },
                          { label: "Lifetime",  rev: totalRevenue, payout: totalWalkerPayout, profit: totalProfit, color: "#059669" },
                        ].map((x, i) => (
                          <div key={i} style={{ background: `${x.color}0d`, border: `1px solid ${x.color}22`,
                            borderRadius: "10px", padding: "12px 10px" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                              fontWeight: 700, color: x.color, textTransform: "uppercase",
                              letterSpacing: "1px", marginBottom: "8px" }}>{x.label}</div>
                            {[
                              { k: "Revenue", v: fmt(x.rev, true) },
                              { k: "Payout",  v: `-$${x.payout}` },
                              { k: "Profit",  v: fmt(x.profit, true) },
                            ].map(row => (
                              <div key={row.k} style={{ display: "flex", justifyContent: "space-between",
                                fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                                padding: "3px 0", color: "#374151" }}>
                                <span style={{ color: "#9ca3af" }}>{row.k}</span>
                                <span style={{ fontWeight: 600 }}>{row.v}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af",
                        fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "8px" }}>By Walker (Lifetime)</div>
                      {walkerProfitRows(completedBookings).length === 0
                        ? <div style={emptyStyle}>No completed walks yet.</div>
                        : walkerProfitRows(completedBookings).map((r, i) => (
                        <div key={i} onClick={() => { if (r.walker) { changeTab("walkers"); setSelectedWalkerId(r.walker.id); setExpandedKpi(null); } }}
                          style={{ ...rowStyle, display: "flex", justifyContent: "space-between", alignItems: "center",
                            cursor: r.walker ? "pointer" : "default" }}>
                          <div>
                            <div style={{ fontWeight: 600, color: "#111827", fontSize: "15px" }}>
                              {r.walker?.avatar || "🐾"} {r.name}
                              {r.walker && <span style={{ color: "#059669", fontSize: "12px", marginLeft: "6px" }}>→ profile</span>}
                            </div>
                            <div style={{ fontSize: "15px", color: "#9ca3af" }}>
                              {r.count} walk{r.count !== 1 ? "s" : ""} · payout ${r.payout}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 600, color: "#059669" }}>+${r.profit}</div>
                            <div style={{ fontSize: "16px", color: "#9ca3af" }}>profit</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }

                if (id === "dailyConfirm") {
                  const byWalker = {};
                  allTodayScheduled.forEach(b => {
                    const name = b.form?.walker || "Unassigned";
                    if (!byWalker[name]) byWalker[name] = { confirmed: 0, total: 0, walker: getAllWalkers(walkerProfiles).find(w => w.name === name) };
                    byWalker[name].total++;
                    if (b.walkerConfirmed) byWalker[name].confirmed++;
                  });
                  const walkerRows = Object.entries(byWalker).sort((a, b) => b[1].total - a[1].total);
                  return (
                    <div>
                      {todayTotalCount === 0 ? (
                        <div style={emptyStyle}>No walks scheduled for today.</div>
                      ) : (
                        <>
                          <div style={{ height: "6px", borderRadius: "99px", background: "#f3f4f6",
                            marginBottom: "14px", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: "99px",
                              background: todayConfirmedCount === todayTotalCount ? "#059669" : "#C4541A",
                              width: `${Math.round((todayConfirmedCount / todayTotalCount) * 100)}%`,
                              transition: "width 0.4s ease" }} />
                          </div>
                          {walkerRows.map(([name, d], i) => {
                            const pct = Math.round((d.confirmed / d.total) * 100);
                            return (
                              <div key={name} onClick={() => { if (d.walker) { changeTab("walkers"); setSelectedWalkerId(d.walker.id); setExpandedKpi(null); } }}
                                style={{ ...rowStyle, display: "flex",
                                  alignItems: "center", gap: "10px",
                                  cursor: d.walker ? "pointer" : "default" }}>
                                <div style={{ fontSize: "18px", flexShrink: 0 }}>
                                  {d.walker?.avatar || "🐾"}
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 600, color: "#111827", fontSize: "15px" }}>
                                    {name}
                                    {d.walker && <span style={{ fontSize: "12px", color: "#3D6B7A", marginLeft: "6px" }}>→ profile</span>}
                                  </div>
                                  <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                                    {d.confirmed}/{d.total} confirmed
                                  </div>
                                </div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                                  fontWeight: 600,
                                  color: d.confirmed === d.total ? "#059669" : d.confirmed > 0 ? "#b45309" : "#9ca3af" }}>
                                  {d.confirmed === d.total ? "✅" : `${pct}%`}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  );
                }

                if (id === "upcoming") {
                  const iStyle = { width: "100%", padding: "8px 10px", borderRadius: "8px",
                    border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", color: "#111827", outline: "none", background: "#fff" };
                  const lStyle = { fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#9ca3af", display: "block", marginBottom: "4px", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "1px" };
                  const TIME_OPTS = [];
                  for (let h = 7; h <= 19; h++) for (const m of [0, 30]) {
                    if (h === 19 && m === 30) break;
                    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
                    const ampm = h < 12 ? "AM" : "PM";
                    TIME_OPTS.push({ label: `${h12}:${m === 0 ? "00" : "30"} ${ampm}`, hour: h, minute: m });
                  }

                  const ovwSaveWalkEdit = (b) => {
                    const d = ovwWalkEditDraft;
                    const client = clients[b.clientId];
                    if (!client) return;
                    const apptDate = new Date(d.date + "T00:00:00");
                    apptDate.setHours(d.timeHour, d.timeMin, 0, 0);
                    const adminDiscount = d.discountAmount > 0
                      ? { type: d.discountType, amount: d.discountAmount }
                      : undefined;
                    const updatedBookings = (client.bookings || []).map(bk =>
                      bk.key === b.key ? {
                        ...bk,
                        scheduledDateTime: apptDate.toISOString(),
                        day: FULL_DAYS[apptDate.getDay() === 0 ? 6 : apptDate.getDay() - 1],
                        date: apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                        slot: { ...bk.slot, time: d.timeLabel, duration: d.duration, hour: d.timeHour, minute: d.timeMin },
                        form: { ...bk.form, pet: d.pet, walker: d.walker, notes: d.notes },
                        price: d.price,
                        adminDiscount,
                      } : bk
                    );
                    const updated = { ...clients, [b.clientId]: { ...client, bookings: updatedBookings } };
                    setClients(updated);
                    saveClients(updated);
                    const prevWalker = b.form?.walker || "";
                    const newWalker  = d.walker || "";
                    if (newWalker && newWalker !== prevWalker) {
                      logAuditEvent({ adminId: admin.id, adminName: admin.name,
                        action: "walker_assigned", entityType: "booking", entityId: b.key,
                        details: {
                          clientName: b.clientName, walkerName: newWalker,
                          previousWalker: prevWalker || null,
                          date: d.date,
                          note: prevWalker ? `Reassigned from ${prevWalker} to ${newWalker}` : `Assigned to ${newWalker}`,
                        } });
                    } else {
                      logAuditEvent({ adminId: admin.id, adminName: admin.name,
                        action: "booking_edited", entityType: "booking", entityId: b.key,
                        details: { clientName: b.clientName, date: d.date, walkerName: newWalker } });
                    }
                    setOvwExpandedWalkKey(null);
                    setOvwWalkEditDraft(null);
                  };

                  return (
                    <div>
                      {upcomingList.length === 0
                        ? <div style={emptyStyle}>No upcoming walks.</div>
                        : upcomingList.slice(0, 15).map((b, i) => {
                          const isOpen = ovwExpandedWalkKey === b.key;
                          const d = ovwWalkEditDraft;
                          return (
                            <div key={b.key || i} style={{ borderBottom: i < Math.min(upcomingList.length, 15) - 1 ? "1px solid #f3f4f6" : "none" }}>
                              {/* Clickable row */}
                              <button onClick={() => {
                                if (isOpen) { setOvwExpandedWalkKey(null); setOvwWalkEditDraft(null); setOvwConfirmDeleteWalkKey(null); return; }
                                const slotDate = b.scheduledDateTime ? new Date(b.scheduledDateTime) : null;
                                setOvwExpandedWalkKey(b.key);
                                setOvwWalkEditDraft({
                                  pet: b.form?.pet || "",
                                  date: slotDate ? slotDate.toISOString().slice(0, 10) : "",
                                  timeLabel: b.slot?.time || "",
                                  timeHour: b.slot?.hour ?? (slotDate?.getHours() ?? 8),
                                  timeMin: b.slot?.minute ?? (slotDate?.getMinutes() ?? 0),
                                  duration: b.slot?.duration || "30 min",
                                  walker: b.form?.walker || "",
                                  notes: b.form?.notes || "",
                                  price: b.price || 0,
                                  discountType: b.adminDiscount?.type || "percent",
                                  discountAmount: b.adminDiscount?.amount || 0,
                                });
                              }} style={{
                                width: "100%", background: isOpen ? "#f9fafb" : "transparent",
                                border: "none", cursor: "pointer", textAlign: "left",
                                padding: "10px 0", display: "flex",
                                justifyContent: "space-between", alignItems: "center", gap: "10px",
                              }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 600, color: "#111827", fontSize: "15px" }}>
                                    {b.clientName} · {b.form?.pet || "Pet"}
                                  </div>
                                  <div style={{ fontSize: "15px", color: "#9ca3af", marginTop: "1px" }}>
                                    {new Date(b.scheduledDateTime || b.bookedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                    {" at "}{new Date(b.scheduledDateTime || b.bookedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                                  <div style={{ fontSize: "15px", color: "#6b7280", textAlign: "right" }}>
                                    {b.form?.walker || <span style={{ color: "#dc2626" }}>Unassigned</span>}
                                    <div style={{ fontSize: "16px", color: "#9ca3af" }}>{b.slot?.duration}</div>
                                  </div>
                                  <span style={{ color: "#9ca3af", fontSize: "16px",
                                    transform: isOpen ? "rotate(180deg)" : "none",
                                    display: "inline-block", transition: "transform 0.15s" }}>⌄</span>
                                </div>
                              </button>

                              {/* Expanded edit panel */}
                              {isOpen && d && (
                                <div className="fade-up" style={{ background: "#f9fafb",
                                  borderRadius: "12px", padding: "16px", marginBottom: "12px",
                                  border: "1.5px solid #e4e7ec" }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                                    <div>
                                      <label style={lStyle}>Pet Name</label>
                                      <input value={d.pet} style={iStyle}
                                        onChange={e => setOvwWalkEditDraft(p => ({ ...p, pet: e.target.value }))} />
                                    </div>
                                    <div>
                                      <label style={lStyle}>Duration</label>
                                      <select value={d.duration} style={iStyle}
                                        onChange={e => setOvwWalkEditDraft(p => ({ ...p, duration: e.target.value }))}>
                                        <option value="30 min">30 min</option>
                                        <option value="60 min">60 min</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                                    <div>
                                      <label style={lStyle}>Date</label>
                                      <input type="date" value={d.date} style={iStyle}
                                        onChange={e => setOvwWalkEditDraft(p => ({ ...p, date: e.target.value }))} />
                                    </div>
                                    <div>
                                      <label style={lStyle}>Time</label>
                                      <select value={`${d.timeHour}:${d.timeMin}`} style={iStyle}
                                        onChange={e => {
                                          const opt = TIME_OPTS.find(t => `${t.hour}:${t.minute}` === e.target.value);
                                          if (opt) setOvwWalkEditDraft(p => ({ ...p, timeLabel: opt.label, timeHour: opt.hour, timeMin: opt.minute }));
                                        }}>
                                        {TIME_OPTS.map(t => (
                                          <option key={t.label} value={`${t.hour}:${t.minute}`}>{t.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <div style={{ marginBottom: "10px" }}>
                                    <label style={lStyle}>Assigned Walker</label>
                                    <select value={d.walker} style={iStyle}
                                      onChange={e => setOvwWalkEditDraft(p => ({ ...p, walker: e.target.value }))}>
                                      <option value="">— Unassigned —</option>
                                      {getAllWalkers(walkerProfiles).map(wk => (
                                        <option key={wk.id} value={wk.name}>{wk.avatar} {wk.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div style={{ marginBottom: "10px" }}>
                                    <label style={lStyle}>Notes</label>
                                    <textarea value={d.notes} rows={2} style={{ ...iStyle, resize: "vertical", lineHeight: "1.5" }}
                                      onChange={e => setOvwWalkEditDraft(p => ({ ...p, notes: e.target.value }))} />
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                                    <div>
                                      <label style={lStyle}>Price ($)</label>
                                      <input type="number" value={d.price} style={iStyle}
                                        onChange={e => setOvwWalkEditDraft(p => ({ ...p, price: Number(e.target.value) }))} />
                                    </div>
                                    <div>
                                      <label style={lStyle}>Discount</label>
                                      <div style={{ display: "flex", gap: "4px" }}>
                                        <select value={d.discountType} style={{ ...iStyle, width: "70px", flexShrink: 0 }}
                                          onChange={e => setOvwWalkEditDraft(p => ({ ...p, discountType: e.target.value, discountAmount: 0 }))}>
                                          <option value="percent">%</option>
                                          <option value="dollar">$</option>
                                        </select>
                                        <input type="number" min="0" value={d.discountAmount} style={iStyle}
                                          placeholder={d.discountType === "percent" ? "0" : "0.00"}
                                          onChange={e => setOvwWalkEditDraft(p => ({ ...p, discountAmount: Number(e.target.value) }))} />
                                      </div>
                                    </div>
                                  </div>
                                  {d.discountAmount > 0 && (
                                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                      color: "#059669", marginBottom: "10px", fontWeight: 500 }}>
                                      💸 Effective price: ${effectivePrice({ price: d.price, adminDiscount: { type: d.discountType, amount: d.discountAmount } })}
                                      
                                    </div>
                                  )}
                                  <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                                    <button onClick={() => ovwSaveWalkEdit(b)}
                                      style={{ padding: "9px 18px", borderRadius: "8px", border: "none",
                                        background: "#3D6B7A", color: "#fff",
                                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                        fontWeight: 600, cursor: "pointer" }}>💾 Save</button>
                                    <button onClick={() => { setOvwExpandedWalkKey(null); setOvwWalkEditDraft(null); setOvwConfirmDeleteWalkKey(null); }}
                                      style={{ padding: "9px 18px", borderRadius: "8px",
                                        border: "1.5px solid #e4e7ec", background: "#fff",
                                        color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                        fontSize: "15px", cursor: "pointer" }}>Cancel</button>
                                  </div>

                                  {/* Delete walk */}
                                  {ovwConfirmDeleteWalkKey !== b.key ? (
                                    <button onClick={() => setOvwConfirmDeleteWalkKey(b.key)}
                                      style={{ padding: "8px 16px", borderRadius: "8px",
                                        border: "1.5px solid #fee2e2", background: "#fff5f5",
                                        color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                                        fontSize: "16px", fontWeight: 600, cursor: "pointer" }}>
                                      🗑 Delete this walk
                                    </button>
                                  ) : (
                                    <div style={{ background: "#fff5f5", border: "1.5px solid #fca5a5",
                                      borderRadius: "10px", padding: "12px 14px" }}>
                                      <div style={{ fontFamily: "'DM Sans', sans-serif",
                                        fontWeight: 600, color: "#dc2626", fontSize: "15px",
                                        marginBottom: "8px" }}>Delete this walk?</div>
                                      <div style={{ fontFamily: "'DM Sans', sans-serif",
                                        fontSize: "16px", color: "#6b7280", marginBottom: "10px" }}>
                                        This will permanently remove the booking for {b.form?.pet || "this pet"} ({b.clientName}) on {b.day}, {b.date}. This can't be undone.
                                      </div>
                                      <div style={{ display: "flex", gap: "8px" }}>
                                        <button onClick={() => {
                                          const client = clients[b.clientId];
                                          if (!client) return;
                                          const updatedBookings = (client.bookings || []).filter(bk => bk.key !== b.key);
                                          const updated = { ...clients, [b.clientId]: { ...client, bookings: updatedBookings } };
                                          setClients(updated);
                                          saveClients(updated);
                                          setOvwExpandedWalkKey(null);
                                          setOvwWalkEditDraft(null);
                                          setOvwConfirmDeleteWalkKey(null);
                                        }} style={{ padding: "8px 16px", borderRadius: "8px", border: "none",
                                          background: "#dc2626", color: "#fff",
                                          fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                          fontWeight: 700, cursor: "pointer" }}>🗑 Yes, Delete</button>
                                        <button onClick={() => setOvwConfirmDeleteWalkKey(null)}
                                          style={{ padding: "8px 16px", borderRadius: "8px",
                                            border: "1.5px solid #e4e7ec", background: "#fff",
                                            color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                            fontSize: "16px", cursor: "pointer" }}>Keep It</button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      }
                      {upcomingList.length > 15 && (
                        <div style={{ ...emptyStyle, marginTop: "6px" }}>+{upcomingList.length - 15} more upcoming walks</div>
                      )}
                    </div>
                  );
                }

                if (id === "completed") {
                  const iStyle = { width: "100%", padding: "8px 10px", borderRadius: "8px",
                    border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", color: "#111827", outline: "none", background: "#fff" };
                  const lStyle = { fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#9ca3af", display: "block", marginBottom: "4px", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "1px" };
                  return (
                    <div>
                      {completedList.length === 0
                        ? <div style={emptyStyle}>No completed walks yet.</div>
                        : completedList.slice(0, 15).map((b, i) => {
                          const isOpen = ovwExpandedWalkKey === `cmp_${b.key}`;
                          const d = ovwWalkEditDraft;
                          const ep = effectivePrice(b);
                          return (
                            <div key={b.key || i} style={{ borderBottom: i < Math.min(completedList.length, 15) - 1 ? "1px solid #f3f4f6" : "none" }}>
                              <button onClick={() => {
                                if (isOpen) { setOvwExpandedWalkKey(null); setOvwWalkEditDraft(null); return; }
                                setOvwExpandedWalkKey(`cmp_${b.key}`);
                                setOvwWalkEditDraft({
                                  price: b.price || 0,
                                  discountType: b.adminDiscount?.type || "percent",
                                  discountAmount: b.adminDiscount?.amount || 0,
                                });
                              }} style={{ width: "100%", background: "transparent", border: "none",
                                cursor: "pointer", textAlign: "left", padding: "10px 0",
                                display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 600, color: "#111827", fontSize: "15px" }}>
                                    {b.clientName}
                                    {b.adminDiscount?.amount > 0 && (
                                      <span style={{ marginLeft: "6px", fontSize: "16px", color: "#059669",
                                        background: "#FDF5EC", border: "1px solid #EDD5A8",
                                        borderRadius: "4px", padding: "1px 5px", fontWeight: 600 }}>
                                        💸 {b.adminDiscount.type === "percent" ? `${b.adminDiscount.amount}% off` : `${fmt(b.adminDiscount.amount, true)} off`}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: "15px", color: "#9ca3af" }}>
                                    {new Date(b.completedAt || b.scheduledDateTime || b.bookedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                    {b.form?.walker ? ` · ${b.form.walker}` : ""}
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600, color: "#059669" }}>
                                    ${ep}
                                    {b.adminDiscount?.amount > 0 && (
                                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                        color: "#9ca3af", fontWeight: 400, marginLeft: "4px",
                                        textDecoration: "line-through" }}>${b.price || 0}</span>
                                    )}
                                  </div>
                                  <span style={{ color: "#9ca3af", fontSize: "16px",
                                    transform: isOpen ? "rotate(180deg)" : "none",
                                    display: "inline-block", transition: "transform 0.15s" }}>⌄</span>
                                </div>
                              </button>
                              {isOpen && d && (
                                <div className="fade-up" style={{ background: "#f9fafb",
                                  borderRadius: "12px", padding: "14px", marginBottom: "10px",
                                  border: "1.5px solid #e4e7ec" }}>
                                  {(() => {
                                    const weekKey = getBookingWeekKey(b);
                                    const walkerName = b.form?.walker;
                                    const isPaid = completedPayrolls.some(r => r.weekKey === weekKey && r.walkerName === walkerName);
                                    if (isPaid) return (
                                      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                                        <span style={{ fontSize: "20px" }}>🔒</span>
                                        <div>
                                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                                            fontSize: "15px", color: "#374151", marginBottom: "4px" }}>
                                            Payroll already paid
                                          </div>
                                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                                            {walkerName ? `${walkerName}'s` : "This walker's"} payroll for this week has been marked as paid. Discounts can no longer be applied to walks in a completed payroll.
                                          </div>
                                        </div>
                                      </div>
                                    );
                                    return (<>
                                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                        color: "#6b7280", marginBottom: "10px" }}>
                                        Edit discount for this completed walk. Base price: <strong>${d.price}</strong>
                                      </div>
                                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                                        <div>
                                          <label style={lStyle}>Discount Type</label>
                                          <select value={d.discountType} style={iStyle}
                                            onChange={e => setOvwWalkEditDraft(p => ({ ...p, discountType: e.target.value, discountAmount: 0 }))}>
                                            <option value="percent">% Percent</option>
                                            <option value="dollar">$ Dollar</option>
                                          </select>
                                        </div>
                                        <div>
                                          <label style={lStyle}>Amount</label>
                                          <input type="number" min="0" value={d.discountAmount} style={iStyle}
                                            placeholder="0"
                                            onChange={e => setOvwWalkEditDraft(p => ({ ...p, discountAmount: Number(e.target.value) }))} />
                                        </div>
                                      </div>
                                      {d.discountAmount > 0 && (
                                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                          color: "#059669", marginBottom: "10px", fontWeight: 500 }}>
                                          💸 Effective price: ${effectivePrice({ price: d.price, adminDiscount: { type: d.discountType, amount: d.discountAmount } })}
                                          {" "}· Revenue recorded: ${effectivePrice({ price: d.price, adminDiscount: { type: d.discountType, amount: d.discountAmount } })}
                                        </div>
                                      )}
                                      <div style={{ display: "flex", gap: "8px" }}>
                                        <button onClick={() => {
                                          const client = clients[b.clientId];
                                          if (!client) return;
                                          const adminDiscount = d.discountAmount > 0
                                            ? { type: d.discountType, amount: d.discountAmount }
                                            : undefined;
                                          const updatedBookings = (client.bookings || []).map(bk =>
                                            bk.key === b.key ? { ...bk, adminDiscount } : bk
                                          );
                                          const updated = { ...clients, [b.clientId]: { ...client, bookings: updatedBookings } };
                                          setClients(updated);
                                          saveClients(updated);
                                          setOvwExpandedWalkKey(null);
                                          setOvwWalkEditDraft(null);
                                        }} style={{ padding: "8px 16px", borderRadius: "8px", border: "none",
                                          background: "#059669", color: "#fff",
                                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                          fontWeight: 600, cursor: "pointer" }}>💾 Save Discount</button>
                                        <button onClick={() => { setOvwExpandedWalkKey(null); setOvwWalkEditDraft(null); }}
                                          style={{ padding: "8px 16px", borderRadius: "8px",
                                            border: "1.5px solid #e4e7ec", background: "#fff",
                                            color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                            fontSize: "15px", cursor: "pointer" }}>Cancel</button>
                                      </div>
                                    </>);
                                  })()}
                                </div>
                              )}
                            </div>
                          );
                        })
                      }
                      {completedList.length > 15 && (
                        <div style={{ ...emptyStyle, marginTop: "6px" }}>+{completedList.length - 15} more completed walks</div>
                      )}
                    </div>
                  );
                }

                if (id === "uninvoiced") {
                  const uninvoicedByClient = Object.entries(clients).filter(([, c]) => !c.deleted).map(([pin, c]) => {
                    const ik = new Set((c.invoices||[]).filter(i=>i.status!=="draft").flatMap(i=>(i.items||[]).map(it=>it.bookingKey)));
                    const walks = (c.bookings||[]).filter(b=>b.adminCompleted&&!b.cancelled&&!ik.has(b.key));
                    return { c, pin, walks };
                  }).filter(x => x.walks.length > 0)
                    .sort((a, b) => b.walks.length - a.walks.length);
                  const totalUninv = uninvoicedByClient.reduce((s, x) => s + x.walks.length, 0);
                  return (
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                        color: "#9ca3af", marginBottom: "12px" }}>
                        {totalUninv} completed walk{totalUninv !== 1 ? "s" : ""} across {uninvoicedByClient.length} client{uninvoicedByClient.length !== 1 ? "s" : ""} not yet invoiced.
                      </div>
                      {uninvoicedByClient.length === 0
                        ? <div style={emptyStyle}>All completed walks have been invoiced.</div>
                        : uninvoicedByClient.map(({ c, pin, walks }) => (
                          <div key={pin} onClick={() => { changeTab("clients"); setSelectedClientId(pin); setExpandedKpi(null); }}
                            style={{ ...rowStyle, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                            <div>
                              <div style={{ fontWeight: 600, color: "#111827", fontSize: "15px" }}>{c.name}</div>
                              <div style={{ fontSize: "14px", color: "#9ca3af" }}>{walks.length} walk{walks.length !== 1 ? "s" : ""} uninvoiced</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 600, color: "#3D6B7A" }}>
                                ${walks.reduce((s, b) => s + effectivePrice(b), 0)}
                              </div>
                              <span style={{ fontSize: "12px", color: "#3D6B7A" }}>→</span>
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  );
                }

                if (id === "pipelineRev") {
                  const upcomingWalks = upcoming.filter(b => !b.isOvernight)
                    .slice().sort((a, b) => new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt));
                  const byWalker = {};
                  upcomingWalks.forEach(b => {
                    const name = b.form?.walker || "Unassigned";
                    if (!byWalker[name]) byWalker[name] = { revenue: 0, payout: 0, count: 0 };
                    byWalker[name].revenue += effectivePrice(b);
                    byWalker[name].payout += getWalkerPayout(b);
                    byWalker[name].count += 1;
                  });
                  const walkerBreakdown = Object.entries(byWalker)
                    .sort((a, b) => b[1].revenue - a[1].revenue)
                    .map(([name, d]) => ({
                      name, revenue: d.revenue,
                      payout: Math.round(d.payout),
                      profit: Math.round(d.revenue - d.payout),
                      count: d.count,
                      walker: getAllWalkers(walkerProfiles).find(w => w.name === name),
                    }));
                  return (
                    <div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                        gap: "8px", marginBottom: "14px" }}>
                        {[
                          { label: "Est. Revenue", val: fmt(pipelineRevenue, true), color: "#7A4D6E" },
                          { label: "Walker Payout", val: `-$${pipelineWalkerPayout}`, color: "#b45309" },
                          { label: "Est. Profit", val: fmt(pipelineProfit, true), color: "#a21caf" },
                        ].map((x, i) => (
                          <div key={i} style={{ background: `${x.color}0d`, border: `1px solid ${x.color}22`,
                            borderRadius: "10px", padding: "10px 8px", textAlign: "center" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                              fontWeight: 600, color: x.color }}>{x.val}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: "#9ca3af", marginTop: "2px" }}>{x.label}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af",
                        fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "8px" }}>By Walker</div>
                      {walkerBreakdown.length === 0
                        ? <div style={emptyStyle}>No upcoming walks.</div>
                        : walkerBreakdown.map((r, i) => (
                        <div key={i} onClick={() => { if (r.walker) { changeTab("walkers"); setSelectedWalkerId(r.walker.id); setExpandedKpi(null); } }}
                          style={{ ...rowStyle, display: "flex", justifyContent: "space-between", alignItems: "center",
                            cursor: r.walker ? "pointer" : "default" }}>
                          <div>
                            <div style={{ fontWeight: 600, color: "#111827", fontSize: "15px" }}>
                              {r.walker?.avatar || "🐾"} {r.name}
                              {r.walker && <span style={{ fontSize: "12px", color: "#7A4D6E", marginLeft: "6px" }}>→ profile</span>}
                            </div>
                            <div style={{ fontSize: "15px", color: "#9ca3af" }}>
                              {r.count} walk{r.count !== 1 ? "s" : ""} · est. payout ${r.payout}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 600, color: "#7A4D6E" }}>${r.revenue}</div>
                            <div style={{ fontSize: "16px", color: "#a21caf" }}>+${r.profit} profit</div>
                          </div>
                        </div>
                      ))}
                      <div style={{ marginTop: "12px", padding: "10px 12px", background: "#F7F0F5",
                        borderRadius: "10px", border: "1px solid #E8D0E0",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#7A4D6E", lineHeight: "1.5" }}>
                        ⚠️ Estimates based on booked prices. Cancellations and reschedules may affect final figures.
                      </div>
                    </div>
                  );
                }

                return null;
              };

              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                  {kpis.map((s) => {
                    const isOpen = expandedKpi === s.id;
                    return (
                      <div key={s.id}
                        style={{ gridColumn: isOpen ? "1 / -1" : undefined,
                          background: "#fff", border: `1.5px solid ${isOpen ? s.color + "55" : s.color + "22"}`,
                          borderRadius: "14px", overflow: "hidden",
                          transition: "border-color 0.2s, box-shadow 0.2s",
                          boxShadow: isOpen ? `0 4px 16px ${s.color}18` : "none",
                          cursor: "pointer" }}
                        onClick={() => { setExpandedKpi(isOpen ? null : s.id); if (isOpen) setKpiWalkDetail(null); }}>
                        <div style={{ padding: "14px 16px", position: "relative" }}>
                          <div style={{ position: "absolute", top: "12px", right: "12px",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: isOpen ? s.color : "#d1d5db", fontWeight: 600,
                            transition: "transform 0.2s, color 0.2s",
                            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</div>
                          <div style={{ paddingRight: "20px" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px",
                              textTransform: "uppercase", letterSpacing: "1px",
                              fontWeight: 600, color: s.color, marginBottom: "4px" }}>{s.label}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                              fontWeight: 700, color: "#111827", lineHeight: 1.1,
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.value}</div>
                            {(s.note || s.detail) && (
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "5px", flexWrap: "wrap" }}>
                                {s.note && (
                                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", fontWeight: 600,
                                    color: s.color, background: `${s.color}15`, padding: "1px 6px",
                                    borderRadius: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                    {s.note}
                                  </span>
                                )}
                                {s.detail && (
                                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                                    color: "#9ca3af" }}>{s.detail}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ borderTop: `1px solid ${s.color}22`,
                            padding: "16px 16px 18px", background: `${s.color}05` }}
                            onClick={e => e.stopPropagation()}>
                            {drawerContent(s.id)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {unassigned.length > 0 && (
              <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca",
                borderRadius: "14px", padding: "16px 18px", marginBottom: "16px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                  fontSize: "15px", color: "#dc2626", marginBottom: "4px" }}>
                  ⚠️ {unassigned.length} {unassigned.length === 1 ? "walk needs" : "walks need"} a walker assigned
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                  Go to "Assign Walks" to resolve these.
                </div>
                <button onClick={() => changeTab("assign")} style={{
                  marginTop: "10px", padding: "8px 16px", borderRadius: "8px",
                  border: "none", background: "#dc2626", color: "#fff",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer" }}>
                  Assign Now →
                </button>
              </div>
            )}

            {/* Walker breakdown */}
            <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
              borderRadius: "16px", padding: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                  fontSize: "15px", color: "#374151" }}>Walker Load (upcoming)</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                  fontWeight: 600, color: "#111827" }}>
                  {upcoming.length} <span style={{ fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", fontWeight: 400, color: "#9ca3af" }}>total walks</span>
                </div>
              </div>
              {getAllWalkers(walkerProfiles).map(w => {
                const walkerWalks = upcoming.filter(b => b.form?.walker === w.name).length;
                const walkerTotal = Object.values(clients).reduce((sum, c) =>
                  sum + (c.bookings || []).filter(b => b.adminCompleted && b.form?.walker === w.name).length, 0);
                return (
                  <button key={w.id} onClick={() => { setTab("walkers"); setSelectedWalkerId(w.id); setWalkerStatView("upcoming"); }}
                    style={{ display: "flex", alignItems: "center", width: "100%",
                      gap: "12px", padding: "10px 0",
                      borderBottom: "1px solid #f3f4f6", background: "none",
                      border: "none", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "50%",
                      background: w.color + "20", display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>{w.avatar}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 600, color: "#111827" }}>{w.name}</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                        {w.role.replace(/ & /g, " / ")} · {walkerTotal} total walk{walkerTotal !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color: w.color }}>
                        {walkerWalks} <span style={{ fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 400, color: "#9ca3af" }}>upcoming</span>
                      </div>
                      <span style={{ color: "#d1d5db", fontSize: "16px" }}>›</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Potential Walkers counter */}
            {(() => {
              const pending = applications.filter(a => a.status === "pending").length;
              const total   = applications.length;
              return (
                <button onClick={async () => {
                  changeTab("applications");
                  if (applications.length === 0) {
                    setAppsLoading(true);
                    try {
                      const res = await fetch(`${SUPABASE_URL}/rest/v1/applications?order=created_at.desc`, {
                        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
                      });
                      const data = await res.json();
                      setApplications(Array.isArray(data) ? data : []);
                    } catch { setApplications([]); }
                    setAppsLoading(false);
                  }
                }} style={{
                  width: "100%", background: pending > 0 ? "#fffbeb" : "#fff",
                  border: `1.5px solid ${pending > 0 ? "#fde68a" : "#e4e7ec"}`,
                  borderRadius: "16px", padding: "18px 20px", cursor: "pointer",
                  textAlign: "left", display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: "12px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <div style={{ width: "44px", height: "44px", borderRadius: "12px",
                      background: pending > 0 ? "#fef9c3" : "#f3f4f6",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "22px", flexShrink: 0 }}>📝</div>
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                        fontSize: "16px", color: "#111827", marginBottom: "2px" }}>
                        Potential Walkers to Review
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>
                        {total === 0 ? "No applications yet" : `${total} total application${total !== 1 ? "s" : ""}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                    {pending > 0 && (
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                          fontWeight: 600, color: "#b45309", lineHeight: 1 }}>{pending}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#b45309", fontWeight: 600, textTransform: "uppercase",
                          letterSpacing: "0.5px" }}>pending</div>
                      </div>
                    )}
                    <span style={{ color: "#d1d5db", fontSize: "16px" }}>›</span>
                  </div>
                </button>
              );
            })()}

            {/* ── Shift Trade Log ── */}
            {(trades || []).length > 0 && (
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "16px", padding: "20px", marginTop: "20px", marginBottom: "4px" }}>
                <div style={{ display: "flex", alignItems: "center",
                  justifyContent: "space-between", marginBottom: "16px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                    fontSize: "15px", color: "#374151" }}>🔄 Shift Trade Log</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#9ca3af" }}>
                    {(trades || []).filter(t => t.status === "pending").length} pending
                  </div>
                </div>
                {(trades || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((trade, i) => {
                  const statusMap = {
                    pending:  { bg: "#fffbeb", border: "#fde68a", color: "#92400e", label: "Pending" },
                    accepted: { bg: "#FDF5EC", border: "#F0E8D5", color: "#059669", label: "✓ Accepted" },
                    declined: { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", label: "✕ Declined" },
                  };
                  const s = statusMap[trade.status] || statusMap.pending;
                  return (
                    <div key={trade.id} style={{
                      display: "flex", alignItems: "flex-start", gap: "12px",
                      padding: "11px 0",
                      borderBottom: i < trades.length - 1 ? "1px solid #f3f4f6" : "none",
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: 600, color: "#111827", marginBottom: "2px" }}>
                          {trade.fromWalkerAvatar} {trade.fromWalker}
                          <span style={{ fontWeight: 400, color: "#6b7280" }}> is offering </span>
                          {trade.pet} ({trade.clientName})
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#9ca3af" }}>
                          {trade.day}, {trade.date} · {trade.time}
                          {trade.bonus > 0 && <span style={{ color: "#b45309", fontWeight: 600 }}> · +${trade.bonus} bonus</span>}
                        </div>
                        {trade.status === "accepted" && trade.acceptedBy && (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#059669", marginTop: "2px", fontWeight: 600 }}>
                            → Picked up by {trade.acceptedBy}
                            {trade.keySwap && <span style={{ color: "#b45309" }}> · 🗝️ Key transferred</span>}
                          </div>
                        )}
                        {trade.reason && (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af", marginTop: "1px", fontStyle: "italic" }}>
                            "{trade.reason}"
                          </div>
                        )}
                        {trade.keySwap && trade.status === "pending" && (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#b45309", marginTop: "2px", fontWeight: 600 }}>
                            🗝️ Key swap pending
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, background: s.bg, border: `1px solid ${s.border}`,
                        borderRadius: "5px", padding: "2px 8px",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        fontWeight: 700, color: s.color }}>{s.label}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Shift Trade Activity Log ── */}
            {trades && trades.length > 0 && (
              <div style={{ marginTop: "20px", marginBottom: "4px" }}>
                <div style={{ display: "flex", alignItems: "center",
                  justifyContent: "space-between", marginBottom: "14px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                    fontSize: "15px", color: "#374151" }}>
                    🔄 Shift Trade Activity
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#9ca3af" }}>{trades.length} trade{trades.length !== 1 ? "s" : ""}</div>
                </div>
                <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                  borderRadius: "14px", overflow: "hidden" }}>
                  {trades.slice().sort((a, b) =>
                    new Date(b.createdAt) - new Date(a.createdAt)
                  ).map((t, i) => {
                    const statusStyles = {
                      pending:  { bg: "#fffbeb", border: "#fde68a", color: "#92400e", label: "Pending" },
                      accepted: { bg: "#FDF5EC", border: "#F0E8D5", color: "#059669", label: "✓ Accepted" },
                      declined: { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", label: "✕ Declined" },
                    };
                    const s = statusStyles[t.status] || statusStyles.pending;
                    const offeredDate = t.createdAt
                      ? new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : "";
                    return (
                      <div key={t.id} style={{
                        padding: "13px 18px",
                        borderBottom: i < trades.length - 1 ? "1px solid #f3f4f6" : "none",
                        background: i % 2 === 0 ? "#fff" : "#fafafa",
                      }}>
                        <div style={{ display: "flex", alignItems: "flex-start",
                          justifyContent: "space-between", gap: "10px" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Who offered */}
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 600, color: "#111827", marginBottom: "3px" }}>
                              {t.fromWalkerAvatar} {t.fromWalker}
                              <span style={{ fontWeight: 400, color: "#9ca3af" }}> offered a trade</span>
                              {t.status === "accepted" && t.acceptedBy && (
                                <span style={{ fontWeight: 400, color: "#059669" }}>
                                  {" "}→ accepted by {t.acceptedBy}
                                </span>
                              )}
                              {t.status === "declined" && t.declinedBy && (
                                <span style={{ fontWeight: 400, color: "#dc2626" }}>
                                  {" "}→ declined by {t.declinedBy}
                                </span>
                              )}
                            </div>
                            {/* Walk details */}
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: "#6b7280" }}>
                              🐕 {t.pet} · {t.clientName} — {t.day}, {t.date} at {t.time}
                            </div>
                            {/* Bonus + reason row */}
                            <div style={{ display: "flex", gap: "10px", marginTop: "4px",
                              flexWrap: "wrap" }}>
                              {t.bonus > 0 && (
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: "#b45309", fontWeight: 600 }}>+${t.bonus} bonus</div>
                              )}
                              {t.reason && (
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: "#9ca3af" }}>"{t.reason}"</div>
                              )}
                              {t.keySwap && (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: "4px",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: t.status === "accepted" ? "#059669" : "#b45309", fontWeight: 600 }}>
                                  🗝️ {t.status === "accepted" ? `Key → ${t.acceptedBy}` : "Key swap included"}
                                </div>
                              )}
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                color: "#d1d5db" }}>offered {offeredDate}</div>
                            </div>
                          </div>
                          {/* Status badge */}
                          <div style={{ flexShrink: 0,
                            background: s.bg, border: `1px solid ${s.border}`,
                            borderRadius: "6px", padding: "3px 9px",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: s.color }}>
                            {s.label}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}


          </div>
        )}

        {/* ── All Bookings ── */}
        {tab === "bookings" && (() => {
          // Generate 30-min time slots 7 AM – 7 PM for the edit form
          const EDIT_TIME_SLOTS = [];
          for (let h = 7; h <= 19; h++) {
            for (const m of [0, 30]) {
              if (h === 19 && m === 30) break;
              const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
              const ampm = h < 12 ? "AM" : "PM";
              EDIT_TIME_SLOTS.push({
                id: `${h}${m === 0 ? "0" : "30"}`,
                label: `${h12}:${m === 0 ? "00" : "30"} ${ampm}`,
                hour: h, minute: m,
              });
            }
          }

          const saveBookingEdit = (booking) => {
            if (!editDraft) return;
            const clientId = booking.clientId;
            if (!clientId || !clients[clientId]) return;

            const apptDate = parseDateLocal(editDraft.date);
            apptDate.setHours(editDraft.timeSlot.hour, editDraft.timeSlot.minute, 0, 0);

            const dateLabel = apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const dayIdx    = apptDate.getDay();
            const dayName   = FULL_DAYS[dayIdx === 0 ? 6 : dayIdx - 1];

            const updatedClients = { ...clients };
            updatedClients[clientId] = {
              ...clients[clientId],
              bookings: clients[clientId].bookings.map(bk =>
                bk.key === booking.key
                  ? {
                      ...bk,
                      day: dayName,
                      date: dateLabel,
                      scheduledDateTime: apptDate.toISOString(),
                      slot: {
                        ...bk.slot,
                        id: editDraft.timeSlot.id,
                        time: editDraft.timeSlot.label,
                        hour: editDraft.timeSlot.hour,
                        minute: editDraft.timeSlot.minute,
                      },
                      form: { ...bk.form, walker: editDraft.walker },
                    }
                  : bk
              ),
            };
            setClients(updatedClients);
            saveClients(updatedClients);
            const prevWalker = booking.form?.walker || "";
            const newWalker  = editDraft.walker || "";
            if (newWalker && newWalker !== prevWalker) {
              logAuditEvent({ adminId: admin.id, adminName: admin.name,
                action: "walker_assigned", entityType: "booking", entityId: editingBookingKey,
                details: {
                  clientName: booking.clientName, walkerName: newWalker,
                  previousWalker: prevWalker || null,
                  date: editDraft.date,
                  note: prevWalker ? `Reassigned from ${prevWalker} to ${newWalker}` : `Assigned to ${newWalker}`,
                } });
            } else {
              logAuditEvent({ adminId: admin.id, adminName: admin.name,
                action: "booking_edited", entityType: "booking", entityId: editingBookingKey,
                details: { date: editDraft.date, walkerName: newWalker } });
            }
            setEditingBookingKey(null);
            setEditDraft(null);
            setExpandedBooking(null);
          };

          const iStyle = {
            padding: "9px 12px", borderRadius: "9px", border: "1.5px solid #e4e7ec",
            background: "#fff", fontFamily: "'DM Sans', sans-serif",
            fontSize: "16px", color: "#111827", outline: "none", width: "100%",
          };

          return (
            <div className="fade-up">
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#111827", marginBottom: "6px" }}>All Bookings</div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
                marginBottom: "12px" }}>
                {upcoming.length} upcoming · {completedBookings.length} completed — click any booking to edit.
              </p>

              {/* Search */}
              <div style={{ position: "relative", marginBottom: "20px" }}>
                <span style={{ position: "absolute", left: "12px", top: "50%",
                  transform: "translateY(-50%)", fontSize: "15px", pointerEvents: "none" }}>🔍</span>
                <input value={bookingSearch} onChange={e => setBookingSearch(e.target.value)}
                  placeholder="Search by client, walker, or pet name…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 36px",
                    borderRadius: "10px", border: "1.5px solid #e4e7ec",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#111827", outline: "none", background: "#fff" }} />
                {bookingSearch && (
                  <button onClick={() => setBookingSearch("")}
                    style={{ position: "absolute", right: "10px", top: "50%",
                      transform: "translateY(-50%)", background: "none", border: "none",
                      cursor: "pointer", color: "#9ca3af", fontSize: "16px", lineHeight: 1 }}>✕</button>
                )}
              </div>

              {/* ── Render a booking card (shared between sections) ── */}
              {(() => {
                const renderBookingCard = (b, i, isCompleted) => {
                  const isExpanded   = expandedBooking === b.key;
                  const isConfirming = completingKey === b.key;
                  const isUndoing    = undoingKey === b.key;
                  const isDeleting   = deletingKey === b.key;
                  const isEditing    = editingBookingKey === b.key;
                  const isPast       = new Date(b.scheduledDateTime || b.bookedAt) <= now;
                  const isUnassigned = !isCompleted && !b.form?.walker;

                  // ── Meet & Greet card ──
                  if (b.isHandoff) {
                    const isHEdit = editingHandoffKey === b.key;
                    const isHDel  = deletingHandoffKey === b.key;
                    const hDraft  = editHandoffDraft;

                    const MG_TIME_SLOTS = [];
                    for (let h = 7; h <= 19; h++) for (const m of [0, 30]) {
                      if (h === 19 && m === 30) break;
                      const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
                      const ampm = h < 12 ? "AM" : "PM";
                      MG_TIME_SLOTS.push(`${h12}:${m === 0 ? "00" : "30"} ${ampm}`);
                    }

                    const saveHandoffEdit = () => {
                      const c = clients[b.clientId];
                      if (!c || !hDraft) return;
                      const [yr, mo, dy] = hDraft.date.split("-").map(Number);
                      const newDate = new Date(yr, mo - 1, dy, 0, 0, 0);
                      const assignedWalker = hDraft.walker || "";
                      // When a walker is assigned to the meet & greet, make them the keyholder
                      // so the client appears in their "My Clients" tab and all unassigned
                      // bookings are auto-assigned to them.
                      const updatedBookings = assignedWalker
                        ? (c.bookings || []).map(bk => {
                            if (bk.cancelled || bk.adminCompleted) return bk;
                            if (bk.form?.walker && bk.form.walker !== "") return bk;
                            return { ...bk, form: { ...bk.form, walker: assignedWalker } };
                          })
                        : (c.bookings || []);
                      const updated = {
                        ...clients,
                        [b.clientId]: {
                          ...c,
                          ...(assignedWalker ? { keyholder: assignedWalker, preferredWalker: assignedWalker } : {}),
                          bookings: updatedBookings,
                          handoffInfo: {
                            ...(c.handoffInfo || {}),
                            handoffDate: newDate.toISOString(),
                            handoffSlot: { time: hDraft.time },
                            handoffWalker: assignedWalker,
                          },
                        },
                      };
                      setClients(updated);
                      saveClients(updated);
                      setEditingHandoffKey(null);
                      setEditHandoffDraft(null);
                    };

                    const deleteHandoff = () => {
                      const c = clients[b.clientId];
                      if (!c) return;
                      const updated = {
                        ...clients,
                        [b.clientId]: { ...c, handoffInfo: null, handoffDone: false },
                      };
                      setClients(updated);
                      saveClients(updated);
                      setDeletingHandoffKey(null);
                    };

                    const hBtnStyle = (variant) => ({
                      padding: "6px 14px", borderRadius: "7px", cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600,
                      border: "none",
                      ...(variant === "save"   ? { background: "#7A4D6E", color: "#fff" } :
                          variant === "cancel" ? { background: "#f3f4f6", color: "#6b7280" } :
                          variant === "delete" ? { background: "#dc2626", color: "#fff" } :
                          variant === "edit"   ? { background: "#F5EFF3", color: "#7A4D6E", border: "1.5px solid #C4A0B8" } :
                                                 { background: "#fef2f2", color: "#dc2626", border: "1.5px solid #fecaca" }),
                    });

                    return (
                      <div key={b.key} style={{ background: "#F5EFF3", border: `1.5px solid ${isHEdit ? "#7A4D6E" : "#C4A0B8"}`,
                        borderRadius: "14px", marginBottom: "10px", overflow: "hidden" }}>
                        {/* Header row */}
                        <div style={{ padding: "14px 18px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                                <span style={{ fontSize: "18px" }}>🤝</span>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                  fontSize: "16px", color: "#7A4D6E" }}>Meet & Greet · 15 min</div>
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280", marginBottom: "2px" }}>
                                📅 {b.day}, {b.date} · {b.slot?.time}
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                                👤 {b.clientName} &nbsp;·&nbsp;
                                🦺 {b.form?.walker || <span style={{ color: "#dc2626", fontWeight: 600 }}>Unassigned</span>}
                              </div>
                            </div>
                            {!isHEdit && !isHDel && (
                              <div style={{ display: "flex", gap: "6px", flexShrink: 0, marginLeft: "10px" }}>
                                <button style={hBtnStyle("edit")} onClick={() => {
                                  const hi = clients[b.clientId]?.handoffInfo || {};
                                  const d = hi.handoffDate ? new Date(hi.handoffDate).toISOString().slice(0, 10) : "";
                                  setEditingHandoffKey(b.key);
                                  setDeletingHandoffKey(null);
                                  setEditHandoffDraft({ date: d, time: hi.handoffSlot?.time || "", walker: hi.handoffWalker || "" });
                                }}>✏️ Edit</button>
                                <button style={hBtnStyle("trash")} onClick={() => {
                                  setDeletingHandoffKey(b.key);
                                  setEditingHandoffKey(null);
                                  setEditHandoffDraft(null);
                                }}>🗑</button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Edit form */}
                        {isHEdit && hDraft && (
                          <div style={{ borderTop: "1px solid #C4A0B844", padding: "14px 18px", background: "#fff" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                              <div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", fontWeight: 700,
                                  letterSpacing: "1.2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "5px" }}>Date</div>
                                <input type="date" value={hDraft.date}
                                  onChange={e => setEditHandoffDraft(p => ({ ...p, date: e.target.value }))}
                                  style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e4e7ec",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px", boxSizing: "border-box", outline: "none" }} />
                              </div>
                              <div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", fontWeight: 700,
                                  letterSpacing: "1.2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "5px" }}>Time</div>
                                <select value={hDraft.time}
                                  onChange={e => setEditHandoffDraft(p => ({ ...p, time: e.target.value }))}
                                  style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e4e7ec",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px", boxSizing: "border-box", outline: "none" }}>
                                  <option value="">— Select time —</option>
                                  {MG_TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                            </div>
                            <div style={{ marginBottom: "12px" }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", fontWeight: 700,
                                letterSpacing: "1.2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "5px" }}>Walker</div>
                              <select value={hDraft.walker}
                                onChange={e => setEditHandoffDraft(p => ({ ...p, walker: e.target.value }))}
                                style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e4e7ec",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px", boxSizing: "border-box", outline: "none" }}>
                                <option value="">— Unassigned —</option>
                                {getAllWalkers(walkerProfiles).map(w => (
                                  <option key={w.id} value={w.name}>{w.avatar} {w.name}</option>
                                ))}
                              </select>
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button style={hBtnStyle("save")} onClick={saveHandoffEdit}>✓ Save</button>
                              <button style={hBtnStyle("cancel")} onClick={() => { setEditingHandoffKey(null); setEditHandoffDraft(null); }}>Cancel</button>
                            </div>
                          </div>
                        )}

                        {/* Delete confirmation */}
                        {isHDel && (
                          <div style={{ borderTop: "1px solid #fecaca", padding: "12px 18px", background: "#fef2f2" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#dc2626",
                              fontWeight: 600, marginBottom: "10px" }}>
                              Remove this Meet & Greet appointment for {b.clientName}?
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button style={hBtnStyle("delete")} onClick={deleteHandoff}>Yes, remove it</button>
                              <button style={hBtnStyle("cancel")} onClick={() => setDeletingHandoffKey(null)}>Keep it</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  const borderColor = isEditing
                    ? "2px solid #b45309"
                    : isExpanded
                      ? `2px solid ${isCompleted ? "#059669" : isUnassigned ? "#fca5a5" : "#3D6B7A"}`
                      : isUnassigned
                        ? "1.5px solid #fecaca"
                        : "1.5px solid #e4e7ec";

                  return (
                    <div key={b.key || i} style={{
                      background: isUnassigned ? "#fef2f2" : "#fff", border: borderColor,
                      borderRadius: "14px", marginBottom: "10px", overflow: "hidden",
                      boxShadow: (isExpanded || isEditing) ? "0 4px 16px rgba(0,0,0,0.08)" : "none",
                      transition: "all 0.15s",
                    }}>
                      {/* Main row */}
                      <button
                        onClick={() => {
                          if (isEditing || isDeleting) return;
                          const next = isExpanded ? null : b.key;
                          setExpandedBooking(next);
                          setCompletingKey(null);
                          setUndoingKey(null);
                          setDeletingKey(null);
                          if (!next) { setEditingBookingKey(null); setEditDraft(null); }
                        }}
                        style={{ width: "100%", background: "none", border: "none",
                          padding: "16px 18px", cursor: isEditing ? "default" : "pointer", textAlign: "left" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px", flexWrap: "wrap" }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                fontSize: "16px", color: "#111827" }}>
                                {b.form?.pet || "Pet"} · {b.slot?.duration}
                              </div>
                              {isCompleted && (
                                <div style={{ background: "#FDF5EC", border: "1px solid #EDD5A8",
                                  borderRadius: "5px", padding: "2px 7px",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                  fontWeight: 600, color: "#059669" }}>✓ COMPLETED</div>
                              )}
                              {!isCompleted && isPast && !isEditing && (
                                <div style={{ background: "#fef3c7", border: "1px solid #fde68a",
                                  borderRadius: "5px", padding: "2px 7px",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                  fontWeight: 600, color: "#92400e" }}>PAST DUE</div>
                              )}
                              {isEditing && (
                                <div style={{ background: "#fff7ed", border: "1px solid #fed7aa",
                                  borderRadius: "5px", padding: "2px 7px",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                  fontWeight: 600, color: "#b45309" }}>EDITING</div>
                              )}
                              {b.isRecurring && !isEditing && (
                                <div style={{ background: "#EBF4F6", border: "1px solid #8ECAD4",
                                  borderRadius: "5px", padding: "2px 7px",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                  fontWeight: 600, color: "#2A7A90" }}>🔁 RECURRING</div>
                              )}
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: "#6b7280", marginBottom: "2px" }}>
                              📅 {isEditing && editDraft
                                ? `${parseDateLocal(editDraft.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${editDraft.timeSlot?.label || b.slot?.time}`
                                : `${b.day}, ${b.date} at ${b.slot?.time}`}
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                              👤 {b.clientName} &nbsp;·&nbsp;
                              🦺 {(isEditing && editDraft ? editDraft.walker : b.form?.walker) || <span style={{ color: "#dc2626", fontWeight: 600 }}>Unassigned</span>}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0, textAlign: "right", marginLeft: "12px" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                              fontWeight: 600, color: isCompleted ? "#059669" : "#C4541A", marginBottom: "4px" }}>
                              ${effectivePrice(b)}
                            </div>
                            {!isEditing && (
                              <div style={{ fontSize: "16px",
                                color: isExpanded ? "#3D6B7A" : "#d1d5db",
                                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                transition: "transform 0.2s, color 0.2s" }}>⌄</div>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* Expanded panel */}
                      {(isExpanded || isEditing || isDeleting) && (
                        <div style={{ borderTop: isEditing ? "1px solid #fed7aa" : "1px solid #f3f4f6",
                          padding: "16px 18px",
                          background: isEditing ? "#fffbf5" : "#fafafa" }}>

                          {/* Default panel */}
                          {!isConfirming && !isUndoing && !isDeleting && !isEditing && (
                            <div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                color: "#6b7280", marginBottom: "12px" }}>
                                📍 {b.form?.address || b.clientAddress || "Address on file"}
                              </div>
                              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                {!isCompleted && (
                                  <button
                                    onClick={e => { e.stopPropagation(); setCompletingKey(b.key); setEarlyAckKey(null); }}
                                    style={{ padding: "9px 16px", borderRadius: "9px", border: "none",
                                      background: "#059669", color: "#fff",
                                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                      fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                                    ✓ Mark Completed
                                  </button>
                                )}
                                {isCompleted && (
                                  <button
                                    onClick={e => { e.stopPropagation(); setUndoingKey(b.key); }}
                                    style={{ padding: "9px 16px", borderRadius: "9px",
                                      border: "1.5px solid #fecaca", background: "#fef2f2",
                                      color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                                      fontSize: "16px", fontWeight: 600, cursor: "pointer",
                                      whiteSpace: "nowrap" }}>
                                    ↩ Undo Completion
                                  </button>
                                )}
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    const existingDate = b.scheduledDateTime
                                      ? new Date(b.scheduledDateTime).toISOString().slice(0, 10)
                                      : new Date().toISOString().slice(0, 10);
                                    const existingSlot = EDIT_TIME_SLOTS.find(
                                      s => s.hour === b.slot?.hour && s.minute === (b.slot?.minute ?? 0)
                                    ) || EDIT_TIME_SLOTS.find(s => s.label === b.slot?.time)
                                      || EDIT_TIME_SLOTS[0];
                                    setEditDraft({ date: existingDate, timeSlot: existingSlot, walker: b.form?.walker || "" });
                                    setEditingBookingKey(b.key);
                                    setCompletingKey(null);
                                    setUndoingKey(null);
                                  }}
                                  style={{ padding: "9px 16px", borderRadius: "9px",
                                    border: "1.5px solid #b4530944", background: "#fff7ed",
                                    color: "#b45309", fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "16px", fontWeight: 600, cursor: "pointer",
                                    whiteSpace: "nowrap" }}>
                                  ✏️ Edit Booking
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); setDeletingKey(b.key); }}
                                  style={{ padding: "9px 16px", borderRadius: "9px",
                                    border: "1.5px solid #fecaca", background: "#fff",
                                    color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "16px", fontWeight: 600, cursor: "pointer",
                                    whiteSpace: "nowrap" }}>
                                  🗑 Delete
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Completing confirmation */}
                          {isConfirming && !isEditing && (() => {
                            const isFuture = b.scheduledDateTime && new Date(b.scheduledDateTime) > new Date();
                            const ackChecked = earlyAckKey === b.key;
                            const canConfirm = !isFuture || ackChecked;
                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  fontWeight: 600, color: "#111827" }}>Confirm walk completed?</div>
                                {isFuture && (
                                  <div style={{ background: "#fef3c7", border: "1.5px solid #fde68a",
                                    borderRadius: "10px", padding: "12px 14px" }}>
                                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                      fontWeight: 700, color: "#92400e", marginBottom: "10px" }}>
                                      ⚠️ This walk hasn't happened yet. Are you sure it's completed?
                                    </div>
                                    <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                                      <input type="checkbox" checked={ackChecked}
                                        onChange={e => setEarlyAckKey(e.target.checked ? b.key : null)}
                                        style={{ width: "17px", height: "17px", cursor: "pointer", accentColor: "#b45309" }} />
                                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                        color: "#92400e", fontWeight: 500 }}>
                                        Yes, I confirm this walk has been completed early
                                      </span>
                                    </label>
                                  </div>
                                )}
                                {!isFuture && (
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                                    This will move the walk to Completed and count toward revenue.
                                  </div>
                                )}
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <button onClick={e => { e.stopPropagation(); markCompleted(b); setEarlyAckKey(null); }}
                                    disabled={!canConfirm}
                                    style={{ flex: 1, padding: "10px", borderRadius: "9px", border: "none",
                                      background: canConfirm ? "#059669" : "#d1d5db", color: "#fff",
                                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                      fontWeight: 600, cursor: canConfirm ? "pointer" : "not-allowed" }}>
                                    ✓ Yes, Mark Completed
                                  </button>
                                  <button onClick={e => { e.stopPropagation(); setCompletingKey(null); setEarlyAckKey(null); }}
                                    style={{ padding: "10px 16px", borderRadius: "9px",
                                      border: "1.5px solid #e4e7ec", background: "#fff",
                                      color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                      fontSize: "15px", cursor: "pointer" }}>Cancel</button>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Undo completion confirmation */}
                          {isUndoing && !isEditing && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 600, color: "#111827" }}>Undo this completion?</div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                                This will move the booking back to Upcoming and remove it from revenue calculations.
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button onClick={e => { e.stopPropagation(); undoCompletion(b); setUndoingKey(null); }}
                                  style={{ flex: 1, padding: "10px", borderRadius: "9px", border: "none",
                                    background: "#dc2626", color: "#fff",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                    fontWeight: 600, cursor: "pointer" }}>
                                  ↩ Yes, Undo
                                </button>
                                <button onClick={e => { e.stopPropagation(); setUndoingKey(null); }}
                                  style={{ padding: "10px 16px", borderRadius: "9px",
                                    border: "1.5px solid #e4e7ec", background: "#fff",
                                    color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "15px", cursor: "pointer" }}>Cancel</button>
                              </div>
                            </div>
                          )}

                          {/* Delete confirmation */}
                          {isDeleting && !isEditing && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 600, color: "#dc2626" }}>Delete this booking?</div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                color: "#6b7280", lineHeight: "1.5" }}>
                                This will permanently remove <strong>{b.form?.pet || "the booking"}</strong> on {b.day}, {b.date} at {b.slot?.time} for {b.clientName}.
                                This action cannot be undone.
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button onClick={e => {
                                  e.stopPropagation();
                                  const cid = b.clientId;
                                  if (!cid || !clients[cid]) return;
                                  const updatedClients = {
                                    ...clients,
                                    [cid]: {
                                      ...clients[cid],
                                      bookings: (clients[cid].bookings || []).filter(bk => bk.key !== b.key),
                                    },
                                  };
                                  setClients(updatedClients);
                                  saveClients(updatedClients);
                                  logAuditEvent({ adminId: admin.id, adminName: admin.name,
                                    action: "booking_deleted", entityType: "booking", entityId: b.key,
                                    details: { clientName: b.clientName, walkerName: b.form?.walker,
                                      pet: b.form?.pet, date: b.date } });
                                  setDeletingKey(null);
                                  setExpandedBooking(null);
                                }}
                                  style={{ flex: 1, padding: "10px", borderRadius: "9px", border: "none",
                                    background: "#dc2626", color: "#fff",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                    fontWeight: 600, cursor: "pointer" }}>
                                  🗑 Yes, Delete
                                </button>
                                <button onClick={e => { e.stopPropagation(); setDeletingKey(null); }}
                                  style={{ padding: "10px 16px", borderRadius: "9px",
                                    border: "1.5px solid #e4e7ec", background: "#fff",
                                    color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "15px", cursor: "pointer" }}>Cancel</button>
                              </div>
                            </div>
                          )}

                          {/* Edit panel */}
                          {isEditing && editDraft && (
                            <div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                                fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                                color: "#b45309", marginBottom: "14px" }}>Edit Booking</div>
                              <div style={{ marginBottom: "12px" }}>
                                <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "15px", fontWeight: 600, color: "#9ca3af",
                                  letterSpacing: "1px", textTransform: "uppercase", marginBottom: "5px" }}>Date</label>
                                <input type="date" value={editDraft.date}
                                  onChange={e => setEditDraft(d => ({ ...d, date: e.target.value }))}
                                  style={iStyle} />
                              </div>
                              <div style={{ marginBottom: "12px" }}>
                                <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "15px", fontWeight: 600, color: "#9ca3af",
                                  letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>Start Time</label>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "5px" }}>
                                  {EDIT_TIME_SLOTS.map(slot => {
                                    const active = editDraft.timeSlot?.id === slot.id;
                                    return (
                                      <button key={slot.id}
                                        onClick={e => { e.stopPropagation(); setEditDraft(d => ({ ...d, timeSlot: slot })); }}
                                        style={{ padding: "7px 3px", borderRadius: "7px", cursor: "pointer",
                                          border: active ? "2px solid #b45309" : "1.5px solid #e4e7ec",
                                          background: active ? "#fff7ed" : "#f9fafb",
                                          color: active ? "#b45309" : "#6b7280",
                                          fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                          fontWeight: active ? 700 : 400, textAlign: "center" }}>
                                        {slot.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div style={{ marginBottom: "16px" }}>
                                <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "15px", fontWeight: 600, color: "#9ca3af",
                                  letterSpacing: "1px", textTransform: "uppercase", marginBottom: "5px" }}>Assigned Walker</label>
                                <select value={editDraft.walker}
                                  onChange={e => setEditDraft(d => ({ ...d, walker: e.target.value }))}
                                  style={{ ...iStyle, color: editDraft.walker ? "#111827" : "#9ca3af" }}>
                                  <option value="">— Unassigned —</option>
                                  {getAllWalkers(walkerProfiles).map(w => (
                                    <option key={w.id} value={w.name}>{w.avatar} {w.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button onClick={e => { e.stopPropagation(); saveBookingEdit(b); }}
                                  style={{ flex: 1, padding: "10px", borderRadius: "9px", border: "none",
                                    background: "#b45309", color: "#fff",
                                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                    fontWeight: 600, cursor: "pointer" }}>
                                  Save Changes ✓
                                </button>
                                <button onClick={e => { e.stopPropagation(); setEditingBookingKey(null); setEditDraft(null); }}
                                  style={{ padding: "10px 16px", borderRadius: "9px",
                                    border: "1.5px solid #e4e7ec", background: "#fff",
                                    color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "15px", cursor: "pointer" }}>Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                const bookingMatchesSearch = (b) => {
                  if (!bookingSearch) return true;
                  const q = bookingSearch.toLowerCase();
                  return (b.clientName || "").toLowerCase().includes(q)
                    || (b.form?.walker || "").toLowerCase().includes(q)
                    || (b.form?.pet    || "").toLowerCase().includes(q)
                    || (b.isHandoff && "meet greet".includes(q));
                };
                const sortedUpcoming = upcoming.filter(bookingMatchesSearch).slice().sort((a, b) =>
                  new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt));
                const sortedCompleted = completedBookings.filter(bookingMatchesSearch).slice().sort((a, b) =>
                  new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) - new Date(a.completedAt || a.scheduledDateTime || a.bookedAt));

                // ── Week grouping helpers ──
                const getWeekStart = (date) => {
                  const d = new Date(date);
                  const day = d.getDay();
                  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
                  d.setHours(0, 0, 0, 0);
                  return d;
                };
                const thisWeekKey  = getWeekStart(new Date()).toISOString().slice(0, 10);
                const nextWeekDate = new Date(getWeekStart(new Date())); nextWeekDate.setDate(nextWeekDate.getDate() + 7);
                const nextWeekKey  = nextWeekDate.toISOString().slice(0, 10);
                const fmtD = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

                const weekGroupMap = {}; const weekGroupOrder = [];
                sortedUpcoming.forEach(b => {
                  const ws = getWeekStart(new Date(b.scheduledDateTime || b.bookedAt));
                  const k  = ws.toISOString().slice(0, 10);
                  if (!weekGroupMap[k]) { weekGroupMap[k] = { key: k, weekStart: ws, bookings: [] }; weekGroupOrder.push(k); }
                  weekGroupMap[k].bookings.push(b);
                });
                const weekGroups = weekGroupOrder.map(k => weekGroupMap[k]);

                const getWeekLabel = (ws, k) => {
                  const we = new Date(ws); we.setDate(we.getDate() + 6);
                  const range = `${fmtD(ws)} – ${fmtD(we)}`;
                  if (k === thisWeekKey) return { title: "This Week", range };
                  if (k === nextWeekKey) return { title: "Next Week", range };
                  return { title: `Week of ${fmtD(ws)}`, range };
                };

                return (
                  <>
                    {/* ── Toggle bar ── */}
                    <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
                      {[
                        { id: "upcoming",  label: "Upcoming",  count: sortedUpcoming.length,  color: "#3D6B7A" },
                        { id: "completed", label: "Completed", count: sortedCompleted.length, color: "#059669" },
                      ].map(v => {
                        const active = bookingsView === v.id;
                        return (
                          <button key={v.id} onClick={() => { setBookingsView(v.id); setExpandedBooking(null); }} style={{
                            padding: "9px 20px", borderRadius: "10px", cursor: "pointer", border: "none",
                            background: active ? v.color : "#f3f4f6",
                            color: active ? "#fff" : "#6b7280",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: active ? 600 : 400, transition: "all 0.15s",
                            display: "flex", alignItems: "center", gap: "8px",
                          }}>
                            {v.label}
                            <span style={{
                              background: active ? "rgba(255,255,255,0.25)" : "#e4e7ec",
                              color: active ? "#fff" : "#9ca3af",
                              borderRadius: "20px", padding: "1px 8px",
                              fontSize: "13px", fontWeight: 600,
                            }}>{v.count}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* ── Upcoming — week groups ── */}
                    {bookingsView === "upcoming" && (
                      weekGroups.length === 0 ? (
                        <div style={{ background: "#fff", borderRadius: "14px", padding: "28px",
                          textAlign: "center", border: "1.5px solid #e4e7ec" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#9ca3af", fontSize: "15px" }}>No upcoming bookings.</div>
                        </div>
                      ) : weekGroups.map(({ key, weekStart, bookings: wBookings }) => {
                        const lbl = getWeekLabel(weekStart, key);
                        const isThisWeek = key === thisWeekKey;
                        return (
                          <div key={key} style={{ marginBottom: "32px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700,
                                letterSpacing: "1.5px", textTransform: "uppercase",
                                color: isThisWeek ? "#C4541A" : "#6b7280",
                                whiteSpace: "nowrap" }}>
                                {lbl.title}
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                                color: "#9ca3af", whiteSpace: "nowrap" }}>{lbl.range}</div>
                              <div style={{ flex: 1, height: "1px", background: isThisWeek ? "#C4541A44" : "#e4e7ec" }} />
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                                color: "#9ca3af", whiteSpace: "nowrap" }}>
                                {wBookings.length} walk{wBookings.length !== 1 ? "s" : ""}
                              </div>
                            </div>
                            {wBookings.map((b, i) => renderBookingCard(b, i, false))}
                          </div>
                        );
                      })
                    )}

                    {/* ── Completed — flat sorted ── */}
                    {bookingsView === "completed" && (
                      sortedCompleted.length === 0 ? (
                        <div style={{ background: "#fff", borderRadius: "14px", padding: "28px",
                          textAlign: "center", border: "1.5px solid #e4e7ec" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#9ca3af", fontSize: "15px" }}>No completed bookings yet.</div>
                        </div>
                      ) : (
                        <div>{sortedCompleted.map((b, i) => renderBookingCard(b, i, true))}</div>
                      )
                    )}
                  </>
                );
              })()}
            </div>
          );
        })()}

        {/* ── Dailies ── */}
        {tab === "dailies" && (() => {
          const amber = "#b45309";
          const todayStr = new Date().toDateString();
          const allTodayBookings = [];
          Object.values(clients).forEach(c => {
            (c.bookings || []).forEach(b => {
              if (b.cancelled || b.adminCompleted) return;
              const appt = new Date(b.scheduledDateTime || b.bookedAt);
              if (appt.toDateString() === todayStr) {
                allTodayBookings.push({ ...b, clientName: c.name });
              }
            });
          });

          const walkerStats = getAllWalkers(walkerProfiles).map(w => {
            const scheduled = allTodayBookings.filter(b => b.form?.walker === w.name);
            const confirmed = scheduled.filter(b => b.walkerConfirmed);
            return { w, scheduled: scheduled.length, confirmed: confirmed.length };
          }).filter(s => s.scheduled > 0);

          const totalScheduled = walkerStats.reduce((s, x) => s + x.scheduled, 0);
          const totalConfirmed = walkerStats.reduce((s, x) => s + x.confirmed, 0);

          return (
            <div className="fade-up">
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Dailies</div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280", marginBottom: "24px" }}>
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>

              {walkerStats.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: "16px", border: "1.5px solid #e4e7ec",
                  padding: "40px", textAlign: "center" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#9ca3af", fontSize: "15px" }}>
                    No walks scheduled for today.
                  </div>
                </div>
              ) : (
                <div style={{ background: "#fff", borderRadius: "16px", border: "1.5px solid #e4e7ec",
                  padding: "20px 24px" }}>
                  {/* Header + overall progress */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "15px", color: "#374151" }}>
                      📋 Today's Walk Confirmations
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                        fontWeight: 600, color: totalConfirmed === totalScheduled && totalScheduled > 0 ? "#059669" : amber }}>
                        {totalConfirmed}<span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 400, color: "#9ca3af" }}>/{totalScheduled}</span>
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>confirmed today</div>
                    </div>
                  </div>
                  <div style={{ height: "6px", borderRadius: "99px", background: "#f3f4f6", marginBottom: "20px", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: "99px",
                      background: totalConfirmed === totalScheduled ? "#059669" : amber,
                      width: totalScheduled > 0 ? `${(totalConfirmed / totalScheduled) * 100}%` : "0%",
                      transition: "width 0.4s ease" }} />
                  </div>
                  {walkerStats.map(({ w, scheduled, confirmed }, i) => {
                    const pct     = scheduled > 0 ? Math.round((confirmed / scheduled) * 100) : 0;
                    const allDone = confirmed === scheduled;
                    const ping    = pings[w.id];
                    const pingAgo = ping ? (() => {
                      const mins = Math.floor((new Date() - ping.at) / 60000);
                      if (mins < 1)  return "just now";
                      if (mins < 60) return `${mins}m ago`;
                      return `${Math.floor(mins / 60)}h ago`;
                    })() : null;
                    return (
                      <div key={w.id} style={{ padding: "12px 0",
                        borderBottom: i < walkerStats.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                          <div style={{ width: "34px", height: "34px", borderRadius: "50%",
                            background: w.color + "20", display: "flex", alignItems: "center",
                            justifyContent: "center", fontSize: "15px", flexShrink: 0 }}>
                            {w.avatar}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 600, color: "#111827" }}>{w.name}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                              {confirmed} of {scheduled} confirmed
                              {w.phone && !allDone && (
                                <span style={{ marginLeft: "8px", color: "#d1d5db" }}>· {w.phone}</span>
                              )}
                            </div>
                          </div>

                          {/* Right side: status + ping button */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px", flexShrink: 0 }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600,
                              color: allDone ? "#059669" : confirmed > 0 ? amber : "#9ca3af" }}>
                              {allDone ? "✅ All done" : `${pct}%`}
                            </div>
                            {!allDone && (
                              <button
                                onClick={() => sendPing(w.id, w.name, w.phone)}
                                style={{
                                  padding: "5px 12px", borderRadius: "8px", cursor: "pointer",
                                  border: ping ? "1.5px solid #e4e7ec" : "1.5px solid #C4541A",
                                  background: ping ? "#f9fafb" : "#FDF5EC",
                                  color: ping ? "#9ca3af" : "#C4541A",
                                  fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "13px", fontWeight: 600,
                                  display: "flex", alignItems: "center", gap: "5px",
                                  transition: "all 0.15s",
                                }}>
                                {ping ? (
                                  <>🔔 Pinged {pingAgo}</>
                                ) : (
                                  <>🔔 Ping</>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={{ height: "4px", borderRadius: "99px", background: "#f3f4f6", overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: "99px",
                            background: allDone ? "#059669" : confirmed > 0 ? "#f59e0b" : "#e5e7eb",
                            width: `${pct}%`, transition: "width 0.4s ease" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Clients ── */}
        {tab === "clients" && (() => {
          const selectedClient = selectedClientId ? clients[selectedClientId] : null;

          if (selectedClient) {
            const c = selectedClient;
            const dogs = c.dogs || c.pets || [];
            const cats = c.cats || [];
            const activeBookings = (c.bookings || []).filter(b => !b.cancelled && !b.adminCompleted);
            const completedClientBookings = (c.bookings || []).filter(b => b.adminCompleted);
            const recurringSchedules = c.recurringSchedules || [];
            const walkScheduleLabel = { "1x": "Easy Rider (1×/week)", "3x": "Steady Stroll (3×/week)", "5x": "Full Gallop (5×/week)" };
            const totalSpend = completedClientBookings.reduce((s, b) => s + effectivePrice(b), 0);
            const memberSince = c.createdAt
              ? new Date(c.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
              : "Unknown";

            const Section = ({ title, children }) => (
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "14px",
                padding: "18px 20px", marginBottom: "12px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px",
                  letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af",
                  marginBottom: "14px" }}>{title}</div>
                {children}
              </div>
            );
            const LegacySection = Section;

            const Field = ({ label, value, missing }) => (
              <div style={{ display: "flex", gap: "12px", paddingBottom: "10px",
                marginBottom: "10px", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                  color: "#9ca3af", minWidth: "130px", flexShrink: 0 }}>{label}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: missing ? "#d1d5db" : "#111827", fontStyle: missing ? "italic" : "normal",
                  fontWeight: missing ? 400 : 500 }}>
                  {missing ? "Not provided" : value}
                </div>
              </div>
            );

            return (
              <div className="fade-up">
                {/* Back button */}
                <button onClick={() => { setSelectedClientId(null); setClientEditMode(false); setClientEditDraft(null); }} style={{
                  display: "flex", alignItems: "center", gap: "6px", background: "none",
                  border: "none", color: "#6b7280", cursor: "pointer", marginBottom: "18px",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px", padding: 0,
                }}>← Back to Clients</button>

                {/* Client hero card */}
                <div style={{ background: "linear-gradient(135deg, #4D2E10, #6B4420)",
                  borderRadius: "18px", padding: "24px 22px", marginBottom: "16px",
                  display: "flex", alignItems: "center", gap: "18px" }}>
                  <div style={{ width: "60px", height: "60px", borderRadius: "50%",
                    background: "#8B5E3C40", border: "2px solid #8B5E3C80",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "26px", flexShrink: 0 }}>
                    {dogs.length > 0 || cats.length > 0 ? "🐾" : "👤"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                      fontWeight: 600, color: "#fff", marginBottom: "3px" }}>
                      {c.name || "Unnamed Client"}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#C4A07A" }}>{c.email}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#9B7444", marginTop: "4px" }}>Member since {memberSince}</div>
                    {c.keyholder && (
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#fbbf24", marginTop: "5px", fontWeight: 600 }}>
                        🗝️ Key held by {c.keyholder}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                      fontWeight: 600, color: "#D4A843" }}>${totalSpend}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#9B7444" }}>total spent</div>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "16px" }}>
                  {[
                    { label: "Active Bookings",  value: activeBookings.length,          color: "#3D6B7A", section: "active-bookings" },
                    { label: "Completed Walks",  value: completedClientBookings.length, color: "#059669", section: "completed-walks" },
                    { label: "Recurring",        value: recurringSchedules.length,       color: "#b45309", section: null },
                  ].map((s, i) => (
                    <div key={i}
                      onClick={() => {
                        if (!s.section) return;
                        const el = document.querySelector(`[data-client-section="${s.section}"]`);
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      style={{ background: "#fff", border: `1.5px solid ${s.color}22`,
                        borderRadius: "12px", padding: "14px 12px", textAlign: "center",
                        cursor: s.section ? "pointer" : "default",
                        transition: "box-shadow 0.15s" }}
                      onMouseEnter={e => { if (s.section) e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.10)"; }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                        fontWeight: 600, color: s.color }}>{s.value}</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        color: "#9ca3af", marginTop: "2px" }}>{s.label}</div>
                      {s.section && (
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                          color: s.color, marginTop: "4px", opacity: 0.7 }}>↓ view</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Lonestar Loyalty & Free Walk Claims */}
                {(() => {
                  const punchCount = c.punchCardCount || 0;
                  const allClaims = c.freeWalkClaims || [];
                  const pendingClaims = allClaims.filter(cl => !cl.fulfilled);
                  const fulfilledClaims = allClaims.filter(cl => cl.fulfilled);
                  if (punchCount === 0 && allClaims.length === 0) return null;
                  return (
                    <div style={{ background: pendingClaims.length > 0 ? "#fffbeb" : "#fff",
                      border: pendingClaims.length > 0 ? "1.5px solid #fcd34d" : "1.5px solid #e4e7ec",
                      borderRadius: "14px", padding: "18px 20px", marginBottom: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px",
                          letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af" }}>⭐ Lonestar Loyalty</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "18px",
                          color: punchCount >= PUNCH_CARD_GOAL ? "#059669" : "#C4541A" }}>
                          {punchCount} / {PUNCH_CARD_GOAL}
                        </div>
                      </div>
                      {/* Paw print grid */}
                      <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginBottom: "12px" }}>
                        {Array.from({ length: PUNCH_CARD_GOAL }).map((_, i) => {
                          const earned = i < punchCount;
                          return (
                            <div key={i} style={{
                              width: "26px", height: "26px",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: earned ? "19px" : "17px",
                              filter: earned ? "none" : "grayscale(1) opacity(0.18)",
                              transform: earned ? "scale(1.08)" : "scale(1)",
                              transition: "all 0.2s",
                            }}>
                              🐾
                            </div>
                          );
                        })}
                      </div>
                      {pendingClaims.length > 0 && (
                        <div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                            fontWeight: 600, color: "#b45309", marginBottom: "8px" }}>
                            ⏳ {pendingClaims.length} pending free walk claim{pendingClaims.length > 1 ? "s" : ""}
                          </div>
                          {pendingClaims.map(cl => (
                            <div key={cl.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                              background: "#fff", border: "1px solid #fcd34d", borderRadius: "10px",
                              padding: "10px 14px", marginBottom: "8px" }}>
                              <div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "#111827" }}>
                                  Free 60-min walk
                                </div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                                  Claimed {new Date(cl.claimedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </div>
                              </div>
                              <button onClick={() => {
                                const updated = fulfillPunchCardClaim(c, cl.id);
                                const updatedClients = { ...clients, [selectedClientId]: updated };
                                setClients(updatedClients);
                                saveClients(updatedClients);
                                logAuditEvent({ adminId: admin.id, adminName: admin.name, action: "free_walk_fulfilled",
                                  entityType: "client", entityId: selectedClientId,
                                  details: { clientName: c.name, walkType: "60 min", claimId: cl.id } });
                              }} style={{
                                padding: "8px 16px", borderRadius: "8px", border: "none",
                                background: "#059669", color: "#fff",
                                fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                                fontWeight: 700, cursor: "pointer",
                              }}>
                                Mark Fulfilled ✓
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {fulfilledClaims.length > 0 && (
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af", marginTop: "4px" }}>
                          {fulfilledClaims.length} free walk{fulfilledClaims.length > 1 ? "s" : ""} fulfilled
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Edit / Save / Cancel bar */}
                <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                  {!clientEditMode ? (
                    <button onClick={() => {
                      setClientEditDraft({
                        name: c.name || "",
                        email: c.email || "",
                        phone: c.phone || "",
                        address: c.address || "",
                        addrObj: c.addrObj || addrFromString(c.address || ""),
                        preferredWalker: c.preferredWalker || "",
                        keyholder: c.keyholder || "",
                        walkSchedule: c.walkSchedule || "",
                        preferredDuration: c.preferredDuration || "",
                        notes: c.notes || "",
                        dogs: [...(c.dogs || c.pets || [])],
                        cats: [...(c.cats || [])],
                      });
                      setClientEditMode(true);
                    }} style={{
                      padding: "9px 18px", borderRadius: "9px", border: "1.5px solid #8B5E3C",
                      background: "#fff", color: "#C4541A", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", fontWeight: 600, cursor: "pointer",
                    }}>✏️ Edit Client</button>
                  ) : (
                    <>
                      <button onClick={() => {
                        const draft = clientEditDraft;
                        const updated = {
                          ...clients,
                          [selectedClientId]: {
                            ...c,
                            name: draft.name,
                            email: draft.email,
                            phone: draft.phone,
                            address: addrToString(draft.addrObj) || draft.address,
                            addrObj: draft.addrObj,
                            preferredWalker: draft.preferredWalker,
                            keyholder: draft.keyholder,
                            walkSchedule: draft.walkSchedule,
                            preferredDuration: draft.preferredDuration,
                            notes: draft.notes,
                            dogs: draft.dogs.filter(d => d.trim()),
                            cats: draft.cats.filter(d => d.trim()),
                          },
                        };
                        setClients(updated);
                        saveClients(updated);
                        setClientEditMode(false);
                        setClientEditDraft(null);
                      }} style={{
                        padding: "9px 18px", borderRadius: "9px", border: "none",
                        background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", fontWeight: 600, cursor: "pointer",
                      }}>💾 Save Changes</button>
                      <button onClick={() => { setClientEditMode(false); setClientEditDraft(null); }}
                        style={{
                          padding: "9px 18px", borderRadius: "9px",
                          border: "1.5px solid #e4e7ec", background: "#fff",
                          color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", cursor: "pointer",
                        }}>Cancel</button>
                    </>
                  )}
                </div>

                {/* Contact & Account Info */}
                <LegacySection title="Contact & Account">
                  {clientEditMode ? (() => {
                    const d = clientEditDraft;
                    const iStyle = { width: "100%", padding: "8px 10px", borderRadius: "8px",
                      border: "1.5px solid #d1d5db", background: "#fff",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#111827",
                      outline: "none" };
                    const lStyle = { fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#9ca3af", display: "block", marginBottom: "4px" };
                    const row = { marginBottom: "12px" };
                    return (
                      <>
                        <div style={row}><label style={lStyle}>Name</label>
                          <input value={d.name} style={iStyle}
                            onChange={e => setClientEditDraft(p => ({ ...p, name: e.target.value }))} />
                        </div>
                        <div style={row}><label style={lStyle}>Email</label>
                          <input type="email" value={d.email} style={iStyle}
                            onChange={e => setClientEditDraft(p => ({ ...p, email: e.target.value }))} />
                        </div>
                        <div style={row}><label style={lStyle}>Phone</label>
                          <input type="tel" value={d.phone} maxLength={12} style={iStyle}
                            placeholder="214.555.0000"
                            onChange={e => setClientEditDraft(p => ({ ...p, phone: formatPhone(e.target.value) }))} />
                        </div>
                        <div style={row}><label style={lStyle}>Address</label>
                          <AddressFields value={d.addrObj}
                            onChange={(obj) => setClientEditDraft(p => ({ ...p, addrObj: obj }))}
                            inputBaseStyle={{ padding: "8px 10px", fontSize: "15px" }} />
                        </div>
                        <Field label="Meet & Greet Scheduled" value={c.handoffDone ? "✓ Yes" : "Not yet"} />
                        <Field label="Meet & Greet Confirmed" value={c.handoffConfirmed ? "✓ Walker confirmed" : "Pending walker confirmation"} />
                        <Field label="Account ID" value={c.id} />
                      </>
                    );
                  })() : (
                    <>
                      <Field label="Email" value={c.email} missing={!c.email} />
                      <Field label="Phone" value={c.phone} missing={!c.phone} />
                      <Field label="Address" value={c.address} missing={!c.address} />
                      <Field label="Meet & Greet Scheduled" value={c.handoffDone ? "✓ Yes" : "Not yet"} />
                      <Field label="Meet & Greet Confirmed" value={c.handoffConfirmed ? "✓ Walker confirmed" : "Pending walker confirmation"} />
                      <Field label="Account ID" value={c.id} />
                    </>
                  )}
                </LegacySection>

                {/* Pets */}
                <LegacySection title="Pets">
                  {clientEditMode ? (() => {
                    const d = clientEditDraft;
                    const iStyle = { flex: 1, padding: "7px 10px", borderRadius: "7px",
                      border: "1.5px solid #d1d5db", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", color: "#111827", outline: "none" };
                    const PetList = ({ label, list, field, addLabel }) => (
                      <div style={{ marginBottom: "14px" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#9ca3af", marginBottom: "8px" }}>{label}</div>
                        {list.map((pet, i) => (
                          <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
                            <input value={pet} style={iStyle}
                              onChange={e => setClientEditDraft(p => ({
                                ...p, [field]: p[field].map((x, j) => j === i ? e.target.value : x)
                              }))} />
                            <button onClick={() => setClientEditDraft(p => ({
                              ...p, [field]: p[field].filter((_, j) => j !== i)
                            }))} style={{ padding: "7px 10px", borderRadius: "7px",
                              border: "1px solid #fecaca", background: "#fef2f2",
                              color: "#dc2626", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                              fontSize: "16px" }}>✕</button>
                          </div>
                        ))}
                        <button onClick={() => setClientEditDraft(p => ({ ...p, [field]: [...p[field], ""] }))}
                          style={{ padding: "6px 12px", borderRadius: "7px",
                            border: "1.5px dashed #d1d5db", background: "transparent",
                            color: "#9ca3af", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "16px" }}>{addLabel}</button>
                      </div>
                    );
                    return (
                      <>
                        <PetList label="🐕 Dogs" list={d.dogs} field="dogs" addLabel="+ Add dog" />
                        <PetList label="🐈 Cats" list={d.cats} field="cats" addLabel="+ Add cat" />
                      </>
                    );
                  })() : (
                    dogs.length === 0 && cats.length === 0 ? (
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#d1d5db", fontStyle: "italic" }}>No pets on file</div>
                    ) : (
                      <>
                        {dogs.length > 0 && (
                          <div style={{ marginBottom: cats.length > 0 ? "12px" : 0 }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#9ca3af", marginBottom: "8px" }}>🐕 Dogs</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                              {dogs.map((dog, i) => (
                                <div key={i} style={{ background: "#FDF5EC", border: "1px solid #EDD5A8",
                                  borderRadius: "8px", padding: "5px 12px",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  fontWeight: 500, color: "#059669" }}>{dog}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {cats.length > 0 && (
                          <div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#9ca3af", marginBottom: "8px" }}>🐈 Cats</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                              {cats.map((cat, i) => (
                                <div key={i} style={{ background: "#EBF4F6", border: "1px solid #8ECAD4",
                                  borderRadius: "8px", padding: "5px 12px",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  fontWeight: 500, color: "#3D6B7A" }}>{cat}</div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )
                  )}
                </LegacySection>

                {/* Preferences */}
                <LegacySection title="Service Preferences">
                  {clientEditMode ? (() => {
                    const d = clientEditDraft;
                    const sel = (val, onChange, children) => (
                      <select value={val} onChange={onChange}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: "8px",
                          border: "1.5px solid #d1d5db", background: "#fff",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: val ? "#111827" : "#9ca3af", cursor: "pointer",
                          marginBottom: "12px", outline: "none" }}>
                        {children}
                      </select>
                    );
                    return (
                      <>
                        <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#9ca3af", display: "block", marginBottom: "4px" }}>Preferred Walker</label>
                        {sel(d.preferredWalker, e => setClientEditDraft(p => ({ ...p, preferredWalker: e.target.value })),
                          <>
                            <option value="">— No preference —</option>
                            {getAllWalkers(walkerProfiles).map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                          </>
                        )}
                        <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#9ca3af", display: "block", marginBottom: "4px" }}>🗝️ Keyholder</label>
                        {sel(d.keyholder, e => setClientEditDraft(p => ({ ...p, keyholder: e.target.value })),
                          <>
                            <option value="">— None assigned —</option>
                            {getAllWalkers(walkerProfiles).map(w => <option key={w.id} value={w.name}>{w.avatar} {w.name}</option>)}
                          </>
                        )}
                        <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#9ca3af", display: "block", marginBottom: "4px" }}>Walk Schedule</label>
                        {sel(d.walkSchedule, e => setClientEditDraft(p => ({ ...p, walkSchedule: e.target.value })),
                          <>
                            <option value="">— Not set —</option>
                            <option value="1x">Easy Rider (1×/week)</option>
                            <option value="3x">Steady Stroll (3×/week)</option>
                            <option value="5x">Full Gallop (5×/week)</option>
                          </>
                        )}
                        <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#9ca3af", display: "block", marginBottom: "4px" }}>Preferred Duration</label>
                        {sel(d.preferredDuration, e => setClientEditDraft(p => ({ ...p, preferredDuration: e.target.value })),
                          <>
                            <option value="">— Not set —</option>
                            <option value="30 min">30 min</option>
                            <option value="60 min">60 min</option>
                          </>
                        )}
                        <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#9ca3af", display: "block", marginBottom: "4px" }}>Notes</label>
                        <textarea value={d.notes} rows={3}
                          onChange={e => setClientEditDraft(p => ({ ...p, notes: e.target.value }))}
                          style={{ width: "100%", padding: "8px 10px", borderRadius: "8px",
                            border: "1.5px solid #d1d5db", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", color: "#111827", resize: "vertical", outline: "none" }} />
                      </>
                    );
                  })() : (
                    <>
                      <Field label="Preferred Walker" value={c.preferredWalker} missing={!c.preferredWalker} />
                      {/* Keyholder — editable dropdown */}
                      <div style={{ display: "flex", gap: "12px", paddingBottom: "10px",
                        marginBottom: "10px", borderBottom: "1px solid #f3f4f6", alignItems: "center" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#9ca3af", minWidth: "130px", flexShrink: 0 }}>🗝️ Keyholder</div>
                        <select value={c.keyholder || ""} onChange={e => {
                          const updated = { ...clients, [selectedClientId]: { ...c, keyholder: e.target.value } };
                          setClients(updated); saveClients(updated);
                        }} style={{ flex: 1, padding: "7px 10px", borderRadius: "8px",
                          border: "1.5px solid #e4e7ec", background: "#fff",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: c.keyholder ? "#111827" : "#9ca3af", cursor: "pointer", outline: "none" }}>
                          <option value="">— None assigned —</option>
                          {getAllWalkers(walkerProfiles).map(w => (
                            <option key={w.id} value={w.name}>{w.avatar} {w.name}</option>
                          ))}
                        </select>
                      </div>
                      <Field label="Walk Schedule" value={walkScheduleLabel[c.walkSchedule] || c.walkSchedule} missing={!c.walkSchedule} />
                      <Field label="Preferred Duration" value={c.preferredDuration} missing={!c.preferredDuration} />
                      <Field label="Notes" value={c.notes} missing={!c.notes} />
                    </>
                  )}
                </LegacySection>

                {/* Meet & Greet Info */}
                {c.handoffInfo && (
                  <LegacySection title="Meet & Greet Appointment">
                    <Field label="Meet & Greet Walker" value={c.handoffInfo.handoffWalker} missing={!c.handoffInfo.handoffWalker} />
                    <Field label="Meet & Greet Date" value={c.handoffInfo.handoffDate ? new Date(c.handoffInfo.handoffDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : null} missing={!c.handoffInfo.handoffDate} />
                    <Field label="Meet & Greet Phone" value={c.handoffInfo.handoffPhone} missing={!c.handoffInfo.handoffPhone} />
                    <Field label="Meet & Greet Address" value={c.handoffInfo.handoffAddress} missing={!c.handoffInfo.handoffAddress} />
                  </LegacySection>
                )}

                {/* Recurring Schedules */}
                {recurringSchedules.length > 0 && (
                  <LegacySection title="Recurring Schedules">
                    {recurringSchedules.map((rec, i) => (
                      <div key={rec.id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 0",
                        borderBottom: i < recurringSchedules.length - 1 ? "1px solid #f3f4f6" : "none",
                      }}>
                        <div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 500, color: "#111827" }}>
                            {FULL_DAYS[rec.dayOfWeek]} at {rec.slotTime}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af", marginTop: "2px" }}>
                            {rec.duration} · {rec.service === "dog" ? "🐕 Dog-walking" : "🐈 Cat-sitting"}
                            {rec.form?.walker && ` · 🦺 ${rec.form.walker}`}
                          </div>
                        </div>
                        <div style={{ background: "#EBF4F6", border: "1px solid #8ECAD4",
                          borderRadius: "6px", padding: "3px 9px",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          fontWeight: 600, color: "#2A7A90" }}>RECURRING</div>
                      </div>
                    ))}
                  </LegacySection>
                )}

                {/* Active Bookings */}
                {activeBookings.length > 0 && (
                  <div data-client-section="active-bookings">
                  <LegacySection title={`Upcoming Bookings (${activeBookings.length})`}>
                    {activeBookings
                      .slice().sort((a, b) => new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt))
                      .map((b, i) => (
                        <div key={b.key || i} style={{
                          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                          gap: "10px", padding: "10px 0",
                          borderBottom: i < activeBookings.length - 1 ? "1px solid #f3f4f6" : "none",
                        }}>
                          <div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 500, color: "#111827" }}>
                              {b.form?.pet || "Pet"} · {b.slot?.duration}
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#6b7280", marginTop: "2px" }}>
                              {b.day}, {b.date} at {b.slot?.time}
                            </div>
                            {b.form?.walker && (
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                color: "#9ca3af", marginTop: "1px" }}>🦺 {b.form.walker}</div>
                            )}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                            fontWeight: 600, color: "#3D6B7A", flexShrink: 0 }}>${effectivePrice(b)}</div>
                        </div>
                      ))}
                  </LegacySection>
                  </div>
                )}

                {/* Completed Walks */}
                <div data-client-section="completed-walks">
                  <LegacySection title={`Completed Walks (${completedClientBookings.length})`}>
                    {completedClientBookings.length === 0 ? (
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", fontStyle: "italic" }}>No completed walks yet.</div>
                    ) : completedClientBookings
                        .slice().sort((a, b) =>
                          new Date(b.scheduledDateTime || b.bookedAt) - new Date(a.scheduledDateTime || a.bookedAt)
                        )
                        .map((b, i) => {
                          const ep = effectivePrice(b);
                          const walkerName = b.form?.walker;
                          const completedDate = b.completedAt || b.scheduledDateTime || b.bookedAt;
                          return (
                            <div key={b.key || i} style={{
                              display: "flex", alignItems: "flex-start",
                              justifyContent: "space-between", gap: "12px",
                              padding: "11px 0",
                              borderBottom: i < completedClientBookings.length - 1 ? "1px solid #f3f4f6" : "none",
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  fontWeight: 600, color: "#111827", marginBottom: "2px" }}>
                                  {b.form?.pet || "Pet"}
                                  <span style={{ fontWeight: 400, color: "#9ca3af" }}> · {b.slot?.duration}</span>
                                  {b.walkerMarkedComplete && (
                                    <span style={{ marginLeft: "6px", fontSize: "13px",
                                      color: "#059669", fontWeight: 500 }}>✓ confirmed</span>
                                  )}
                                </div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "14px", color: "#6b7280" }}>
                                  {b.day}, {b.date}
                                  {b.slot?.time && ` · ${b.slot.time}`}
                                  {walkerName && (
                                    <span style={{ color: "#9ca3af" }}> · {walkerName}</span>
                                  )}
                                </div>
                                {b.adminDiscount?.amount > 0 && (
                                  <div style={{ fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "13px", color: "#b45309", marginTop: "2px" }}>
                                    💸 {b.adminDiscount.type === "percent"
                                      ? `${b.adminDiscount.amount}% discount applied`
                                      : `${fmt(b.adminDiscount.amount, true)} discount applied`}
                                  </div>
                                )}
                              </div>
                              <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "16px", fontWeight: 700, color: "#059669" }}>
                                  {fmt(ep, true)}
                                </div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "13px", color: "#9ca3af" }}>
                                  billed
                                </div>
                              </div>
                            </div>
                          );
                        })
                    }
                    {completedClientBookings.length > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between",
                        alignItems: "center", paddingTop: "12px",
                        borderTop: "1.5px solid #f3f4f6", marginTop: "4px" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: 600, color: "#374151" }}>
                          Total · {completedClientBookings.length} walk{completedClientBookings.length !== 1 ? "s" : ""}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "17px",
                          fontWeight: 700, color: "#111827" }}>
                          {fmt(totalSpend, true)}
                        </div>
                      </div>
                    )}
                  </LegacySection>
                </div>

                {confirmDeleteClientId !== c.id ? (
                  <button
                    onClick={() => setConfirmDeleteClientId(c.id)}
                    style={{ width: "100%", padding: "12px", borderRadius: "12px",
                      border: "1.5px solid #fecaca", background: "#fff",
                      color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", fontWeight: 600, cursor: "pointer",
                      marginTop: "8px" }}>
                    🗑 Delete Client
                  </button>
                ) : (
                  <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca",
                    borderRadius: "14px", padding: "20px", marginTop: "8px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                      fontSize: "16px", color: "#dc2626", marginBottom: "8px" }}>
                      Delete {c.name || "this client"}?
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#374151", lineHeight: "1.6", marginBottom: "16px" }}>
                      They will be removed from the client roster and will no longer be able to log in.
                      Their completed walk history, revenue contribution, and walker earnings records
                      are fully preserved.
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => {
                        const bookingsToCancel = (c.bookings || []).filter(b => !b.adminCompleted && !b.cancelled);
                        // Build the deleted client record with all non-completed bookings cancelled
                        let deletedClientRecord = {
                          ...c,
                          deleted: true,
                          deletedAt: new Date().toISOString(),
                          bookings: (c.bookings || []).map(b =>
                            b.adminCompleted ? b : { ...b, cancelled: true, cancelledAt: new Date().toISOString() }
                          ),
                          recurringSchedules: [],
                        };
                        // Revoke Lonestar Loyalty punches for every booking being cancelled now
                        for (const b of bookingsToCancel) {
                          deletedClientRecord = revokePunchCard(deletedClientRecord, b.key);
                        }
                        const updatedClients = {
                          ...clients,
                          [selectedClientId]: deletedClientRecord,
                        };
                        setClients(updatedClients);
                        saveClients(updatedClients);
                        // Notify each assigned walker and the client of their cancelled bookings
                        bookingsToCancel.forEach(b => {
                          const walkerName = b.form?.walker || "";
                          const walkerObj = getAllWalkers(walkerProfiles).find(w => w.name === walkerName);
                          if (walkerObj?.email) {
                            sendWalkerCancellationNotification({
                              walkerName: walkerObj.name,
                              walkerEmail: walkerObj.email,
                              clientName: c.name,
                              pet: b.form?.pet || "",
                              service: b.form?.service || "",
                              date: b.date || "",
                              day: b.day || "",
                              time: b.slot?.time || "—",
                              duration: b.slot?.duration || "—",
                            });
                          }
                          if (c.email) {
                            sendClientCancellationNotification({
                              clientName: c.name,
                              clientEmail: c.email,
                              pet: b.form?.pet || "",
                              service: b.form?.service || "",
                              date: b.date || "",
                              day: b.day || "",
                              time: b.slot?.time || "—",
                              duration: b.slot?.duration || "—",
                              walker: walkerName || "",
                            });
                          }
                        });
                        logAuditEvent({ adminId: admin.id, adminName: admin.name,
                          action: "client_deleted", entityType: "client", entityId: selectedClientId,
                          details: { clientName: c.name, email: c.email,
                            bookingsCancelled: bookingsToCancel.length } });
                        setConfirmDeleteClientId(null);
                        setSelectedClientId(null);
                      }} style={{ flex: 1, padding: "11px", borderRadius: "9px", border: "none",
                        background: "#dc2626", color: "#fff",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 700, cursor: "pointer" }}>
                        Yes, Delete Client
                      </button>
                      <button onClick={() => setConfirmDeleteClientId(null)}
                        style={{ padding: "11px 18px", borderRadius: "9px",
                          border: "1.5px solid #e4e7ec", background: "#fff",
                          color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

              </div>
            );
          }

          // ── Client list view ──────────────────────────────────────────────
          const clientList = Object.entries(clients).filter(([, c]) => !c.deleted).map(([pin, c]) => {
            const dogs  = c.dogs || c.pets || [];
            const cats  = c.cats || [];
            const nameParts = (c.name || "").trim().split(/\s+/);
            return {
              c, pin,
              dogs, cats,
              pets: [...dogs, ...cats],
              firstName:     nameParts[0] || "",
              lastName:      nameParts.length > 1 ? nameParts[nameParts.length - 1] : (nameParts[0] || ""),
              petCount:      dogs.length + cats.length,
              totalWalks:    (c.bookings || []).filter(b => !b.cancelled).length,
              completedCount:(c.bookings || []).filter(b => b.adminCompleted).length,
              activeCount:   (c.bookings || []).filter(b => !b.cancelled && !b.adminCompleted).length,
              totalSpend:    (c.bookings || []).filter(b => b.adminCompleted).reduce((s, b) => s + effectivePrice(b), 0),
            };
          });

          const SORT_OPTIONS = [
            { key: "firstName",  label: "First Name" },
            { key: "lastName",   label: "Last Name"  },
            { key: "petCount",   label: "# Pets"     },
            { key: "totalWalks", label: "Total Walks" },
            { key: "totalSpend", label: "Total Spend" },
          ];

          const handleSort = (key) => {
            if (clientSortKey === key) {
              setClientSortDir(d => d === "asc" ? "desc" : "asc");
            } else {
              setClientSortKey(key);
              setClientSortDir("asc");
            }
          };

          // New = signed up within 48 hrs AND no admin has viewed them yet
          const isNewClient = (c) =>
            !c.adminViewedAt &&
            c.createdAt &&
            (Date.now() - new Date(c.createdAt).getTime() < 48 * 3600000);

          const sortedClients = [...clientList].filter(({ c, pets }) => {
            if (!clientSearch) return true;
            const q = clientSearch.toLowerCase();
            return (c.name || "").toLowerCase().includes(q)
              || (c.email || "").toLowerCase().includes(q)
              || (c.dogs || []).some(d => d.toLowerCase().includes(q))
              || (c.cats || []).some(d => d.toLowerCase().includes(q));
          }).sort((a, b) => {
            const aNew = isNewClient(a.c) ? 1 : 0;
            const bNew = isNewClient(b.c) ? 1 : 0;
            if (bNew !== aNew) return bNew - aNew;
            let av = a[clientSortKey], bv = b[clientSortKey];
            const cmp = typeof av === "string"
              ? av.localeCompare(bv, undefined, { sensitivity: "base" })
              : (av - bv);
            return clientSortDir === "asc" ? cmp : -cmp;
          });

          return (
            <div className="fade-up">
              {/* Header row with Add Client button */}
              <div style={{ display: "flex", alignItems: "flex-start",
                justifyContent: "space-between", marginBottom: "6px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                  fontWeight: 600, color: "#111827" }}>Clients</div>
                <button
                  onClick={() => setShowAdminAddClient(v => !v)}
                  style={{ padding: "9px 18px", borderRadius: "10px", border: "none",
                    background: showAdminAddClient ? "#e4e7ec" : "#C4541A",
                    color: showAdminAddClient ? "#374151" : "#fff",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                    flexShrink: 0, marginTop: "4px" }}>
                  {showAdminAddClient ? "✕ Cancel" : "+ Add Client"}
                </button>
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
                marginBottom: "12px" }}>
                {Object.keys(clients).length} registered client{Object.keys(clients).length !== 1 ? "s" : ""} — click any client to view their full profile.
              </p>

              {/* Search */}
              <div style={{ position: "relative", marginBottom: "16px" }}>
                <span style={{ position: "absolute", left: "12px", top: "50%",
                  transform: "translateY(-50%)", fontSize: "15px", pointerEvents: "none" }}>🔍</span>
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  placeholder="Search by name, email, or pet…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 36px",
                    borderRadius: "10px", border: "1.5px solid #e4e7ec",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#111827", outline: "none", background: "#fff" }} />
                {clientSearch && (
                  <button onClick={() => setClientSearch("")}
                    style={{ position: "absolute", right: "10px", top: "50%",
                      transform: "translateY(-50%)", background: "none", border: "none",
                      cursor: "pointer", color: "#9ca3af", fontSize: "16px", lineHeight: 1 }}>✕</button>
                )}
              </div>

              {/* ── Add Client form ── */}
              {showAdminAddClient && (
                <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                  borderRadius: "14px", marginBottom: "16px", overflow: "hidden" }}>
                  <div style={{ background: "#C4541A", padding: "12px 18px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                      fontSize: "15px", color: "#fff" }}>Add New Client</div>
                  </div>
                  <div style={{ padding: "16px" }}>
                    <AddLegacyClientForm
                      clients={clients}
                      setClients={setClients}
                      onDone={() => setShowAdminAddClient(false)}
                      walkerProfiles={walkerProfiles}
                      admin={admin}
                    />
                  </div>
                </div>
              )}

              {/* Sort bar */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "16px" }}>
                {SORT_OPTIONS.map(opt => {
                  const active = clientSortKey === opt.key;
                  return (
                    <button key={opt.key} onClick={() => handleSort(opt.key)} style={{
                      padding: "6px 12px", borderRadius: "8px", cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: active ? 600 : 400,
                      border: active ? "1.5px solid #4D2E10" : "1.5px solid #e4e7ec",
                      background: active ? "#4D2E10" : "#fff",
                      color: active ? "#d97706" : "#6b7280",
                      display: "flex", alignItems: "center", gap: "4px",
                      transition: "all 0.12s",
                    }}>
                      {opt.label}
                      {active && <span style={{ fontSize: "16px" }}>{clientSortDir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  );
                })}
              </div>

              {sortedClients.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: "16px", padding: "40px",
                  textAlign: "center", border: "1.5px solid #e4e7ec" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#9ca3af", fontSize: "16px" }}>
                    No clients registered yet.
                  </div>
                </div>
              ) : sortedClients.map(({ c, pin, pets, activeCount, completedCount, totalSpend }) => {
                const isNew = isNewClient(c);
                return (
                <button key={c.id}
                  onClick={() => {
                    setSelectedClientId(pin);
                    // Mark as viewed by this admin if not already
                    if (isNew) {
                      const updated = {
                        ...clients,
                        [pin]: { ...c, adminViewedAt: new Date().toISOString() },
                      };
                      setClients(updated);
                    }
                  }}
                  style={{
                    width: "100%", background: isNew ? "#FDF5EC" : "#fff",
                    border: isNew ? "1.5px solid #C4541A" : "1.5px solid #e4e7ec",
                    borderRadius: "14px", padding: "0", marginBottom: "10px",
                    cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                    overflow: "hidden",
                  }}
                  className="hover-card"
                >
                  {isNew && (
                    <div style={{
                      background: "#C4541A",
                      padding: "5px 18px", display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%",
                        background: "#fff", display: "inline-block", flexShrink: 0 }} />
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px",
                        fontWeight: 700, color: "#fff", letterSpacing: "1.5px",
                        textTransform: "uppercase" }}>New Client</span>
                    </div>
                  )}
                  <div style={{ padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <div style={{ width: "44px", height: "44px", borderRadius: "50%",
                        background: "#8B5E3C18", border: "1.5px solid #8B5E3C30",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "18px", flexShrink: 0 }}>
                        {pets.length > 0 ? "🐾" : "👤"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "16px", color: "#111827", marginBottom: "2px" }}>
                          {c.name || "Unnamed"}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#6b7280", marginBottom: "2px" }}>{c.email}</div>
                        {pets.length > 0 && (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af" }}>🐾 {pets.join(", ")}</div>
                        )}
                        {c.keyholder && (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#b45309", marginTop: "3px" }}>🗝️ {c.keyholder}</div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, textAlign: "right" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "flex-end" }}>
                          {activeCount > 0 && (
                            <div style={{ background: "#EBF4F6", border: "1px solid #8ECAD4",
                              borderRadius: "5px", padding: "2px 8px",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 600, color: "#3D6B7A" }}>
                              {activeCount} upcoming
                            </div>
                          )}
                          {completedCount > 0 && (
                            <div style={{ background: "#FDF5EC", border: "1px solid #EDD5A8",
                              borderRadius: "5px", padding: "2px 8px",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 600, color: "#059669" }}>
                              {completedCount} done
                            </div>
                          )}
                          {totalSpend > 0 && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 600, color: "#C4541A" }}>${totalSpend}</div>
                          )}
                        </div>
                        <div style={{ fontSize: "16px", color: "#d1d5db", marginTop: "4px" }}>›</div>
                      </div>
                    </div>
                  </div>
                </button>
                );
              })}
            </div>
          );
        })()}

        {/* ── Walkers ── */}
        {tab === "walkers" && (() => {
          const selWalker = selectedWalkerId ? getAllWalkers(walkerProfiles).find(w => w.id === selectedWalkerId) : null;
          const selProfile = selectedWalkerId ? (walkerProfiles[selectedWalkerId] || {}) : {};

          if (selWalker) {
            const w = selWalker;
            const prof = selProfile;
            const walkerUpcoming = upcoming.filter(b => b.form?.walker === w.name);
            const walkerCompleted = completedBookings.filter(b => b.form?.walker === w.name);
            const totalEarnings = Math.round(walkerCompleted.reduce((s, b) => s + getWalkerPayout(b), 0));
            const draft = editingWalker || prof;
            const isEditing = !!editingWalker;

            const Field = ({ label, field, placeholder, value }) => (
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700,
                  letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af",
                  marginBottom: "6px" }}>{label}</div>
                {isEditing ? (
                  <input
                    value={draft[field] || ""}
                    onChange={e => setEditingWalker(prev => ({ ...prev, [field]: e.target.value }))}
                    placeholder={placeholder || ""}
                    style={{ width: "100%", padding: "10px 13px", borderRadius: "9px",
                      border: "1.5px solid #d1d5db", background: "#f9fafb",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#111827", outline: "none" }}
                  />
                ) : (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: value || draft[field] ? "#111827" : "#d1d5db",
                    fontStyle: value || draft[field] ? "normal" : "italic",
                    fontWeight: value || draft[field] ? 500 : 400 }}>
                    {value || draft[field] || "Not provided"}
                  </div>
                )}
              </div>
            );

            const isConfirmingDelete = confirmDeleteWalkerId === w.id;

            const deleteWalker = () => {
              // 1. Mark walker as deleted in profiles (preserves history)
              const updatedProfiles = {
                ...walkerProfiles,
                [w.id]: {
                  ...(walkerProfiles[w.id] || {}),
                  deleted: true,
                  deletedAt: new Date().toISOString(),
                  name: w.name, // preserve name for historic display
                  preferredName: prof.preferredName || w.name,
                  role: w.role,
                  avatar: w.avatar,
                  color: w.color,
                },
              };
              setWalkerProfiles(updatedProfiles);
              saveWalkerProfiles(updatedProfiles);
              deleteWalkerFromDB(w.id); // physically remove row so it can't be re-added by future saves

              // 2. Unassign from all upcoming (non-completed) bookings
              const updatedClients = {};
              Object.entries(clients).forEach(([cid, c]) => {
                const updatedBookings = (c.bookings || []).map(b => {
                  if (b.adminCompleted || b.cancelled) return b;
                  if (b.form?.walker === w.name) {
                    return { ...b, form: { ...b.form, walker: "" } };
                  }
                  return b;
                });
                updatedClients[cid] = { ...c, bookings: updatedBookings };
              });
              setClients(updatedClients);
              saveClients(updatedClients);

              // 3. Remove from runtime registries
              injectCustomWalkers(updatedProfiles);

              logAuditEvent({ adminId: admin.id, adminName: admin.name,
                action: "walker_deleted", entityType: "walker", entityId: w.id,
                details: { walkerName: w.name, role: w.role } });

              setConfirmDeleteWalkerId(null);
              setSelectedWalkerId(null);
              setEditingWalker(null);
            };

            return (
              <div className="fade-up">
                {/* Back */}
                <button onClick={() => { setSelectedWalkerId(null); setEditingWalker(null); setConfirmDeleteWalkerId(null); setWalkerStatView(null); }}
                  style={{ display: "flex", alignItems: "center", gap: "6px", background: "none",
                    border: "none", color: "#6b7280", cursor: "pointer", marginBottom: "18px",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px", padding: 0 }}>
                  ← Back to Walkers
                </button>

                {/* Hero */}
                <div style={{ background: `linear-gradient(135deg, ${w.color}22, ${w.color}08)`,
                  border: `1.5px solid ${w.color}33`, borderRadius: "18px",
                  padding: "24px 22px", marginBottom: "16px",
                  display: "flex", alignItems: "center", gap: "18px" }}>
                  <div style={{ width: "64px", height: "64px", borderRadius: "50%",
                    background: w.color + "20", border: `2px solid ${w.color}60`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "28px", flexShrink: 0 }}>{w.avatar}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                      fontWeight: 600, color: "#111827", marginBottom: "2px" }}>
                      {prof.preferredName || w.name}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: w.color, fontWeight: 500 }}>{(w.role || "").replace(/ & /g, " / ")}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#9ca3af", marginTop: "3px" }}>{w.years}+ years experience</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                      fontWeight: 600, color: "#7A4D6E" }}>${totalEarnings}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#9ca3af" }}>total earned</div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                  gap: "10px", marginBottom: "16px" }}>
                  {[
                    { id: "upcoming",  label: "Upcoming",  value: walkerUpcoming.length,  color: w.color },
                    { id: "completed", label: "Completed", value: walkerCompleted.length, color: "#059669" },
                    { id: "earnings",  label: "Earnings",  value: fmt(totalEarnings, true),    color: "#7A4D6E" },
                  ].map(s => {
                    const active = walkerStatView === s.id;
                    return (
                      <button key={s.id}
                        onClick={() => setWalkerStatView(active ? null : s.id)}
                        className="hover-card"
                        style={{ background: active ? s.color : "#fff",
                          border: `1.5px solid ${active ? s.color : s.color + "22"}`,
                          borderRadius: "12px", padding: "14px 10px", textAlign: "center",
                          cursor: "pointer", transition: "all 0.15s" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                          fontWeight: 600, color: active ? "#fff" : s.color }}>{s.value}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: active ? "#ffffffcc" : "#9ca3af", marginTop: "2px" }}>{s.label}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Pending bio approval */}
                {prof.pendingBio && prof.pendingBio !== prof.bio && (
                  <div className="fade-up" style={{ background: "#fffbeb",
                    border: "1.5px solid #fde68a", borderRadius: "14px",
                    padding: "16px 20px", marginBottom: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px",
                      marginBottom: "10px" }}>
                      <span style={{ fontSize: "16px" }}>⏳</span>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                        fontSize: "15px", color: "#92400e" }}>Pending Bio Approval</div>
                    </div>
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#374151", lineHeight: "1.65", marginBottom: "14px",
                      padding: "10px 14px", background: "#fff", borderRadius: "8px",
                      border: "1px solid #fde68a" }}>
                      {prof.pendingBio}
                    </p>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => {
                        const updated = {
                          ...walkerProfiles,
                          [w.id]: { ...prof, bio: prof.pendingBio, pendingBio: "" },
                        };
                        setWalkerProfiles(updated);
                        saveWalkerProfiles(updated);

                      }} style={{ padding: "9px 18px", borderRadius: "8px",
                        border: "none", background: "#C4541A", color: "#fff",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 600, cursor: "pointer" }}>
                        ✓ Approve & Publish
                      </button>
                      <button onClick={() => {
                        const updated = {
                          ...walkerProfiles,
                          [w.id]: { ...prof, pendingBio: "" },
                        };
                        setWalkerProfiles(updated);
                        saveWalkerProfiles(updated);
                      }} style={{ padding: "9px 18px", borderRadius: "8px",
                        border: "1.5px solid #e4e7ec", background: "#fff",
                        color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", cursor: "pointer" }}>
                        ✕ Reject
                      </button>
                    </div>
                    {prof.bio && (
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", marginTop: "10px" }}>
                        Current published bio: "{prof.bio.slice(0, 60)}{prof.bio.length > 60 ? "…" : ""}"
                      </div>
                    )}
                  </div>
                )}

                {/* Stat detail panel */}
                {walkerStatView && (() => {
                  const fmtDate = (iso) =>
                    new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

                  if (walkerStatView === "upcoming") {
                    const sorted = [...walkerUpcoming].sort((a, b) =>
                      new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt)
                    );

                    const TIME_OPTS = [];
                    for (let h = 7; h <= 19; h++) for (const m of [0, 30]) {
                      if (h === 19 && m === 30) break;
                      const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
                      const ampm = h < 12 ? "AM" : "PM";
                      TIME_OPTS.push({ label: `${h12}:${m === 0 ? "00" : "30"} ${ampm}`, hour: h, minute: m });
                    }

                    const saveWalkEdit = (b) => {
                      const d = walkEditDraft;
                      const clientId = b.clientId;
                      const client = clients[clientId];
                      if (!client) return;
                      const apptDate = new Date(d.date + "T00:00:00");
                      apptDate.setHours(d.timeHour, d.timeMin, 0, 0);
                      const adminDiscount = d.discountAmount > 0
                        ? { type: d.discountType, amount: d.discountAmount }
                        : undefined;
                      const updatedBookings = (client.bookings || []).map(bk =>
                        bk.key === b.key ? {
                          ...bk,
                          scheduledDateTime: apptDate.toISOString(),
                          day: FULL_DAYS[apptDate.getDay() === 0 ? 6 : apptDate.getDay() - 1],
                          date: apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                          slot: { ...bk.slot, time: d.timeLabel, duration: d.duration, hour: d.timeHour, minute: d.timeMin },
                          form: { ...bk.form, pet: d.pet, walker: d.walker, notes: d.notes },
                          price: d.price,
                          adminDiscount,
                        } : bk
                      );
                      const updated = { ...clients, [clientId]: { ...client, bookings: updatedBookings } };
                      setClients(updated);
                      saveClients(updated);
                      setExpandedWalkKey(null);
                      setWalkEditDraft(null);
                    };

                    return (
                      <div className="fade-up" style={{ background: "#fff",
                        border: `1.5px solid ${w.color}22`, borderRadius: "14px",
                        padding: "18px 20px", marginBottom: "16px" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                          fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                          color: "#9ca3af", marginBottom: "14px" }}>
                          Upcoming Walks ({sorted.length})
                        </div>
                        {sorted.length === 0 ? (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af", fontStyle: "italic" }}>No upcoming walks scheduled.</div>
                        ) : sorted.map((b, i) => {
                          const isOpen = expandedWalkKey === b.key;
                          const d = walkEditDraft;
                          const iStyle = { width: "100%", padding: "8px 10px", borderRadius: "8px",
                            border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", color: "#111827", outline: "none", background: "#fff" };
                          const lStyle = { fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af", display: "block", marginBottom: "4px", fontWeight: 600,
                            textTransform: "uppercase", letterSpacing: "1px" };
                          return (
                            <div key={b.key || i} style={{
                              borderBottom: i < sorted.length - 1 ? "1px solid #f3f4f6" : "none",
                            }}>
                              {/* Clickable row */}
                              <button onClick={() => {
                                if (isOpen) { setExpandedWalkKey(null); setWalkEditDraft(null); return; }
                                const slotDate = b.scheduledDateTime ? new Date(b.scheduledDateTime) : null;
                                setExpandedWalkKey(b.key);
                                setWalkEditDraft({
                                  pet: b.form?.pet || "",
                                  date: slotDate ? slotDate.toISOString().slice(0, 10) : "",
                                  timeLabel: b.slot?.time || "",
                                  timeHour: b.slot?.hour ?? (slotDate?.getHours() ?? 8),
                                  timeMin: b.slot?.minute ?? (slotDate?.getMinutes() ?? 0),
                                  duration: b.slot?.duration || "30 min",
                                  walker: b.form?.walker || "",
                                  notes: b.form?.notes || "",
                                  price: b.price || 0,
                                  discountType: b.adminDiscount?.type || "percent",
                                  discountAmount: b.adminDiscount?.amount || 0,
                                });
                              }} style={{
                                width: "100%", background: isOpen ? `${w.color}06` : "transparent",
                                border: "none", cursor: "pointer", textAlign: "left",
                                padding: "10px 0", display: "flex",
                                justifyContent: "space-between", alignItems: "center",
                              }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                    fontWeight: 600, color: "#111827", marginBottom: "2px" }}>
                                    {b.form?.pet || "Pet"}
                                    <span style={{ fontWeight: 400, color: "#9ca3af", fontSize: "16px" }}> · {b.slot?.duration}</span>
                                  </div>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
                                    {b.day}, {b.date} at {b.slot?.time}
                                    <span style={{ color: "#9ca3af" }}> · {b.clientName}</span>
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "16px", fontWeight: 600, color: w.color }}>
                                    ${Math.round(getWalkerPayout(b))}
                                  </div>
                                  <span style={{ color: "#9ca3af", fontSize: "16px",
                                    transform: isOpen ? "rotate(180deg)" : "none",
                                    display: "inline-block", transition: "transform 0.15s" }}>⌄</span>
                                </div>
                              </button>

                              {/* Expanded edit panel */}
                              {isOpen && d && (
                                <div className="fade-up" style={{ background: "#f9fafb",
                                  borderRadius: "12px", padding: "16px", marginBottom: "12px",
                                  border: `1.5px solid ${w.color}22` }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                                    <div>
                                      <label style={lStyle}>Pet Name</label>
                                      <input value={d.pet} style={iStyle}
                                        onChange={e => setWalkEditDraft(p => ({ ...p, pet: e.target.value }))} />
                                    </div>
                                    <div>
                                      <label style={lStyle}>Duration</label>
                                      <select value={d.duration} style={iStyle}
                                        onChange={e => setWalkEditDraft(p => ({ ...p, duration: e.target.value }))}>
                                        <option value="30 min">30 min</option>
                                        <option value="60 min">60 min</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                                    <div>
                                      <label style={lStyle}>Date</label>
                                      <input type="date" value={d.date} style={iStyle}
                                        onChange={e => setWalkEditDraft(p => ({ ...p, date: e.target.value }))} />
                                    </div>
                                    <div>
                                      <label style={lStyle}>Time</label>
                                      <select value={`${d.timeHour}:${d.timeMin}`} style={iStyle}
                                        onChange={e => {
                                          const opt = TIME_OPTS.find(t => `${t.hour}:${t.minute}` === e.target.value);
                                          if (opt) setWalkEditDraft(p => ({ ...p, timeLabel: opt.label, timeHour: opt.hour, timeMin: opt.minute }));
                                        }}>
                                        {TIME_OPTS.map(t => (
                                          <option key={t.label} value={`${t.hour}:${t.minute}`}>{t.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <div style={{ marginBottom: "10px" }}>
                                    <label style={lStyle}>Assigned Walker</label>
                                    <select value={d.walker} style={iStyle}
                                      onChange={e => setWalkEditDraft(p => ({ ...p, walker: e.target.value }))}>
                                      <option value="">— Unassigned —</option>
                                      {getAllWalkers(walkerProfiles).map(wk => (
                                        <option key={wk.id} value={wk.name}>{wk.avatar} {wk.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div style={{ marginBottom: "10px" }}>
                                    <label style={lStyle}>Notes</label>
                                    <textarea value={d.notes} rows={2} style={{ ...iStyle, resize: "vertical", lineHeight: "1.5" }}
                                      onChange={e => setWalkEditDraft(p => ({ ...p, notes: e.target.value }))} />
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                                    <div>
                                      <label style={lStyle}>Price ($)</label>
                                      <input type="number" value={d.price} style={iStyle}
                                        onChange={e => setWalkEditDraft(p => ({ ...p, price: Number(e.target.value) }))} />
                                    </div>
                                    <div>
                                      <label style={lStyle}>Discount</label>
                                      <div style={{ display: "flex", gap: "4px" }}>
                                        <select value={d.discountType} style={{ ...iStyle, width: "70px", flexShrink: 0 }}
                                          onChange={e => setWalkEditDraft(p => ({ ...p, discountType: e.target.value, discountAmount: 0 }))}>
                                          <option value="percent">%</option>
                                          <option value="dollar">$</option>
                                        </select>
                                        <input type="number" min="0" value={d.discountAmount} style={iStyle}
                                          placeholder={d.discountType === "percent" ? "0" : "0.00"}
                                          onChange={e => setWalkEditDraft(p => ({ ...p, discountAmount: Number(e.target.value) }))} />
                                      </div>
                                    </div>
                                  </div>
                                  {d.discountAmount > 0 && (
                                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                      color: "#059669", marginBottom: "10px", fontWeight: 500 }}>
                                      💸 Effective price: ${effectivePrice({ price: d.price, adminDiscount: { type: d.discountType, amount: d.discountAmount } })}
                                      
                                    </div>
                                  )}
                                  <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                                    <button onClick={() => saveWalkEdit(b)}
                                      style={{ padding: "9px 18px", borderRadius: "8px", border: "none",
                                        background: w.color, color: "#fff",
                                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                        fontWeight: 600, cursor: "pointer" }}>💾 Save</button>
                                    <button onClick={() => { setExpandedWalkKey(null); setWalkEditDraft(null); setConfirmDeleteWalkKey(null); }}
                                      style={{ padding: "9px 18px", borderRadius: "8px",
                                        border: "1.5px solid #e4e7ec", background: "#fff",
                                        color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                        fontSize: "15px", cursor: "pointer" }}>Cancel</button>
                                  </div>

                                  {/* Delete walk */}
                                  {confirmDeleteWalkKey !== b.key ? (
                                    <button onClick={() => setConfirmDeleteWalkKey(b.key)}
                                      style={{ padding: "8px 16px", borderRadius: "8px",
                                        border: "1.5px solid #fee2e2", background: "#fff5f5",
                                        color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                                        fontSize: "16px", fontWeight: 600, cursor: "pointer" }}>
                                      🗑 Delete this walk
                                    </button>
                                  ) : (
                                    <div style={{ background: "#fff5f5", border: "1.5px solid #fca5a5",
                                      borderRadius: "10px", padding: "12px 14px" }}>
                                      <div style={{ fontFamily: "'DM Sans', sans-serif",
                                        fontWeight: 600, color: "#dc2626", fontSize: "15px",
                                        marginBottom: "8px" }}>Delete this walk?</div>
                                      <div style={{ fontFamily: "'DM Sans', sans-serif",
                                        fontSize: "16px", color: "#6b7280", marginBottom: "10px" }}>
                                        This will permanently remove the booking for {b.form?.pet || "this pet"} on {b.day}, {b.date}. This can't be undone.
                                      </div>
                                      <div style={{ display: "flex", gap: "8px" }}>
                                        <button onClick={() => {
                                          const clientId = b.clientId;
                                          const client = clients[clientId];
                                          if (!client) return;
                                          const updatedBookings = (client.bookings || []).filter(bk => bk.key !== b.key);
                                          const updated = { ...clients, [clientId]: { ...client, bookings: updatedBookings } };
                                          setClients(updated);
                                          saveClients(updated);
                                          setExpandedWalkKey(null);
                                          setWalkEditDraft(null);
                                          setConfirmDeleteWalkKey(null);
                                        }} style={{ padding: "8px 16px", borderRadius: "8px", border: "none",
                                          background: "#dc2626", color: "#fff",
                                          fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                          fontWeight: 700, cursor: "pointer" }}>🗑 Yes, Delete</button>
                                        <button onClick={() => setConfirmDeleteWalkKey(null)}
                                          style={{ padding: "8px 16px", borderRadius: "8px",
                                            border: "1.5px solid #e4e7ec", background: "#fff",
                                            color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                            fontSize: "16px", cursor: "pointer" }}>Keep It</button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  if (walkerStatView === "completed") {
                    const sorted = [...walkerCompleted].sort((a, b) =>
                      new Date(b.scheduledDateTime || b.bookedAt) - new Date(a.scheduledDateTime || a.bookedAt)
                    );
                    const iStyle = { width: "100%", padding: "8px 10px", borderRadius: "8px",
                      border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", color: "#111827", outline: "none", background: "#fff" };
                    const lStyle = { fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#9ca3af", display: "block", marginBottom: "4px", fontWeight: 600,
                      textTransform: "uppercase", letterSpacing: "1px" };
                    return (
                      <div className="fade-up" style={{ background: "#fff",
                        border: "1.5px solid #05996922", borderRadius: "14px",
                        padding: "18px 20px", marginBottom: "16px" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                          fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                          color: "#9ca3af", marginBottom: "14px" }}>
                          Completed Walks ({sorted.length})
                        </div>
                        {sorted.length === 0 ? (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af", fontStyle: "italic" }}>No completed walks yet.</div>
                        ) : sorted.map((b, i) => {
                          const isOpen = expandedWalkKey === `cmp_${b.key}`;
                          const d = walkEditDraft;
                          const ep = effectivePrice(b);
                          return (
                            <div key={b.key || i} style={{ borderBottom: i < sorted.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                              <button onClick={() => {
                                if (isOpen) { setExpandedWalkKey(null); setWalkEditDraft(null); return; }
                                setExpandedWalkKey(`cmp_${b.key}`);
                                setWalkEditDraft({
                                  price: b.price || 0,
                                  discountType: b.adminDiscount?.type || "percent",
                                  discountAmount: b.adminDiscount?.amount || 0,
                                });
                              }} style={{ width: "100%", background: "transparent", border: "none",
                                cursor: "pointer", textAlign: "left", padding: "10px 0",
                                display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                    fontWeight: 600, color: "#111827", marginBottom: "2px" }}>
                                    {b.form?.pet || "Pet"}
                                    <span style={{ fontWeight: 400, color: "#9ca3af", fontSize: "16px" }}> · {b.slot?.duration}</span>
                                    {b.adminDiscount?.amount > 0 && (
                                      <span style={{ marginLeft: "6px", fontSize: "16px", color: "#059669",
                                        background: "#FDF5EC", border: "1px solid #EDD5A8",
                                        borderRadius: "4px", padding: "1px 5px", fontWeight: 600 }}>
                                        💸 {b.adminDiscount.type === "percent" ? `${b.adminDiscount.amount}% off` : `${fmt(b.adminDiscount.amount, true)} off`}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
                                    {fmtDate(b.scheduledDateTime || b.bookedAt)}
                                    {b.slot?.time && ` at ${b.slot?.time}`}
                                    <span style={{ color: "#9ca3af" }}> · {b.clientName}</span>
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif",
                                    fontSize: "16px", fontWeight: 600, color: "#059669" }}>
                                    ${getWalkerPayout(b)}
                                    {b.adminDiscount?.amount > 0 && (
                                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                        color: "#9ca3af", fontWeight: 400, marginLeft: "4px",
                                        textDecoration: "line-through" }}>${getWalkerPayout({ ...b, adminDiscount: null })}</span>
                                    )}
                                  </div>
                                  <span style={{ color: "#9ca3af", fontSize: "16px",
                                    transform: isOpen ? "rotate(180deg)" : "none",
                                    display: "inline-block", transition: "transform 0.15s" }}>⌄</span>
                                </div>
                              </button>

                              {isOpen && d && (
                                <div className="fade-up" style={{ background: "#f9fafb",
                                  borderRadius: "12px", padding: "14px", marginBottom: "10px",
                                  border: "1.5px solid #05996922" }}>
                                  {(() => {
                                    const weekKey = getBookingWeekKey(b);
                                    const walkerName = b.form?.walker;
                                    const isPaid = completedPayrolls.some(r => r.weekKey === weekKey && r.walkerName === walkerName);
                                    if (isPaid) return (
                                      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                                        <span style={{ fontSize: "20px" }}>🔒</span>
                                        <div>
                                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                                            fontSize: "15px", color: "#374151", marginBottom: "4px" }}>
                                            Payroll already paid
                                          </div>
                                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                                            {walkerName ? `${walkerName}'s` : "This walker's"} payroll for this week has been marked as paid. Discounts can no longer be applied to walks in a completed payroll.
                                          </div>
                                        </div>
                                      </div>
                                    );
                                    return (<>
                                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                        color: "#6b7280", marginBottom: "10px" }}>
                                        Edit discount for this completed walk. Base price: <strong>${d.price}</strong>
                                      </div>
                                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                                        <div>
                                          <label style={lStyle}>Discount Type</label>
                                          <select value={d.discountType} style={iStyle}
                                            onChange={e => setWalkEditDraft(p => ({ ...p, discountType: e.target.value, discountAmount: 0 }))}>
                                            <option value="percent">% Percent</option>
                                            <option value="dollar">$ Dollar</option>
                                          </select>
                                        </div>
                                        <div>
                                          <label style={lStyle}>Amount</label>
                                          <input type="number" min="0" value={d.discountAmount} style={iStyle}
                                            placeholder="0"
                                            onChange={e => setWalkEditDraft(p => ({ ...p, discountAmount: Number(e.target.value) }))} />
                                        </div>
                                      </div>
                                      {d.discountAmount > 0 && (
                                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                          color: "#059669", marginBottom: "10px", fontWeight: 500 }}>
                                          💸 Effective price: ${effectivePrice({ price: d.price, adminDiscount: { type: d.discountType, amount: d.discountAmount } })}
                                          
                                        </div>
                                      )}
                                      <div style={{ display: "flex", gap: "8px" }}>
                                        <button onClick={() => {
                                          const client = clients[b.clientId];
                                          if (!client) return;
                                          const adminDiscount = d.discountAmount > 0
                                            ? { type: d.discountType, amount: d.discountAmount }
                                            : undefined;
                                          const updatedBookings = (client.bookings || []).map(bk =>
                                            bk.key === b.key ? { ...bk, adminDiscount } : bk
                                          );
                                          const updated = { ...clients, [b.clientId]: { ...client, bookings: updatedBookings } };
                                          setClients(updated);
                                          saveClients(updated);
                                          setExpandedWalkKey(null);
                                          setWalkEditDraft(null);
                                        }} style={{ padding: "8px 16px", borderRadius: "8px", border: "none",
                                          background: "#059669", color: "#fff",
                                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                          fontWeight: 600, cursor: "pointer" }}>💾 Save Discount</button>
                                        <button onClick={() => { setExpandedWalkKey(null); setWalkEditDraft(null); }}
                                          style={{ padding: "8px 16px", borderRadius: "8px",
                                            border: "1.5px solid #e4e7ec", background: "#fff",
                                            color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                                            fontSize: "15px", cursor: "pointer" }}>Cancel</button>
                                      </div>
                                    </>);
                                  })()}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  if (walkerStatView === "earnings") {
                    // Group completed walks by Mon–Sun week
                    const byWeek = {};
                    walkerCompleted.forEach(b => {
                      const d = new Date(b.scheduledDateTime || b.bookedAt);
                      const dow = d.getDay();
                      const mon = new Date(d);
                      mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
                      mon.setHours(0, 0, 0, 0);
                      const key = mon.toISOString().slice(0, 10);
                      if (!byWeek[key]) byWeek[key] = { mon, walks: [] };
                      byWeek[key].walks.push(b);
                    });
                    const weeks = Object.entries(byWeek)
                      .sort(([a], [b]) => b.localeCompare(a)); // newest first

                    return (
                      <div className="fade-up" style={{ background: "#fff",
                        border: "1.5px solid #7A4D6E22", borderRadius: "14px",
                        padding: "18px 20px", marginBottom: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center",
                          justifyContent: "space-between", marginBottom: "14px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                            fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                            color: "#9ca3af" }}>Earnings by Week</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                            fontWeight: 600, color: "#7A4D6E" }}>${totalEarnings} total</div>
                        </div>
                        {weeks.length === 0 ? (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af", fontStyle: "italic" }}>No earnings recorded yet.</div>
                        ) : weeks.map(([key, { mon, walks }], i) => {
                          const sun = new Date(mon);
                          sun.setDate(mon.getDate() + 6);
                          const weekTotal = Math.round(walks.reduce((s, b) => s + getWalkerPayout(b), 0));
                          const label =
                            mon.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                            " – " +
                            sun.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                          return (
                            <div key={key} style={{
                              padding: "12px 0",
                              borderBottom: i < weeks.length - 1 ? "1px solid #f3f4f6" : "none",
                            }}>
                              <div style={{ display: "flex", alignItems: "center",
                                justifyContent: "space-between", marginBottom: "6px" }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  fontWeight: 600, color: "#111827" }}>{label}</div>
                                <div style={{ fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color: "#7A4D6E" }}>
                                  ${weekTotal}
                                </div>
                              </div>
                              {walks
                                .sort((a, b) => new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt))
                                .map((b, j) => (
                                <div key={b.key || j} style={{
                                  display: "flex", justifyContent: "space-between",
                                  alignItems: "center", padding: "4px 0 4px 12px",
                                  borderLeft: `2px solid #7A4D6E22`,
                                }}>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                    color: "#6b7280" }}>
                                    {fmtDate(b.scheduledDateTime || b.bookedAt)}
                                    {b.slot?.time && ` at ${b.slot?.time}`}
                                    {" · "}{b.form?.pet || "Pet"}{" · "}{b.clientName}
                                  </div>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                    fontWeight: 600, color: "#7A4D6E", flexShrink: 0 }}>
                                    ${Math.round(getWalkerPayout(b))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  return null;
                })()}

                {/* ── Team Page Visibility (standalone toggle — no edit mode needed) ── */}
                {(() => {
                  const isVisible = prof.showOnTeamPage ?? true;
                  const handleToggle = () => {
                    const updated = {
                      ...walkerProfiles,
                      [w.id]: { ...prof, showOnTeamPage: !isVisible },
                    };
                    setWalkerProfiles(updated);
                    saveWalkerProfiles(updated);
                    if (isEditing) setEditingWalker(prev => ({ ...prev, showOnTeamPage: !isVisible }));
                  };
                  return (
                    <button onClick={handleToggle} style={{
                      width: "100%", marginBottom: "12px",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "14px 18px", borderRadius: "12px", cursor: "pointer",
                      border: `1.5px solid ${isVisible ? "#D4A843" : "#e4e7ec"}`,
                      background: isVisible ? "#FDF5EC" : "#f9fafb",
                      textAlign: "left",
                    }}>
                      <div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                          fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                          color: isVisible ? "#C4541A" : "#9ca3af", marginBottom: "2px" }}>
                          Team Page Listing
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: isVisible ? "#374151" : "#9ca3af" }}>
                          {isVisible ? "Shown on the public team page" : "Hidden from the public team page"}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, padding: "7px 16px", borderRadius: "8px",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700,
                        background: isVisible ? "#C4541A" : "#e4e7ec",
                        color: isVisible ? "#fff" : "#9ca3af",
                        marginLeft: "12px" }}>
                        {isVisible ? "✓ Visible" : "Hidden"}
                      </div>
                    </button>
                  );
                })()}

                {/* Profile Card */}
                <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                  borderRadius: "14px", padding: "20px", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center",
                    justifyContent: "space-between", marginBottom: "18px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                      fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                      color: "#9ca3af" }}>Walker Profile</div>
                    {!isEditing ? (
                      <button
                        onClick={() => setEditingWalker({ ...prof })}
                        style={{ padding: "5px 14px", borderRadius: "7px",
                          border: `1.5px solid ${w.color}44`, background: `${w.color}10`,
                          color: w.color, fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
                        ✏️ Edit
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: "7px" }}>
                        <button
                          onClick={() => {
                            const updated = { ...walkerProfiles, [w.id]: { ...prof, ...editingWalker, address: addrToString(editingWalker.addrObj || editingWalker.address) } };
                            setWalkerProfiles(updated);
                            saveWalkerProfiles(updated);

                            setEditingWalker(null);
                          }}
                          style={{ padding: "5px 14px", borderRadius: "7px", border: "none",
                            background: "#059669", color: "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 600, cursor: "pointer" }}>
                          ✓ Save
                        </button>
                        <button
                          onClick={() => setEditingWalker(null)}
                          style={{ padding: "5px 12px", borderRadius: "7px",
                            border: "1.5px solid #e4e7ec", background: "#fff",
                            color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "15px", cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  <Field label="Email" field="email" placeholder="walker@lonestarbark.com"
                    value={prof.email || w.email} />
                  <Field label="Phone" field="phone" placeholder="(214) 555-0000" />
                  <div style={{ marginBottom: "14px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700,
                      letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af",
                      marginBottom: "8px" }}>Home Address</div>
                    {isEditing ? (
                      <AddressFields
                        value={draft.addrObj || addrFromString(draft.address || "")}
                        onChange={(obj, str) => setEditingWalker(prev => ({ ...prev, addrObj: obj, address: str }))}
                        inputBaseStyle={{ padding: "9px 12px", fontSize: "16px" }}
                        labelBaseStyle={{ fontSize: "16px" }}
                      />
                    ) : (
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: draft.address ? "#111827" : "#d1d5db",
                        fontStyle: draft.address ? "normal" : "italic",
                        fontWeight: draft.address ? 500 : 400 }}>
                        {draft.address || "Not provided"}
                      </div>
                    )}
                  </div>
                  <Field label="Preferred Name" field="preferredName" placeholder={w.name} />
                  <Field label="Preferred Availability" field="preferredAvailability"
                    placeholder="e.g. Mon–Fri 8am–5pm, weekends flexible" />
                </div>

                {/* Bio */}
                <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                  borderRadius: "14px", padding: "18px 20px", marginBottom: "12px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                    fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                    color: "#9ca3af", marginBottom: "10px" }}>Bio</div>
                  {isEditing ? (
                    <textarea
                      value={draft.bio ?? w.bio ?? ""}
                      onChange={e => setEditingWalker(prev => ({ ...prev, bio: e.target.value }))}
                      rows={5}
                      placeholder="A brief intro for the team and landing page…"
                      style={{ width: "100%", padding: "10px 13px", borderRadius: "9px",
                        border: "1.5px solid #d1d5db", background: "#f9fafb",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#111827", outline: "none", resize: "vertical", lineHeight: "1.65" }}
                    />
                  ) : (
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: draft.bio || w.bio ? "#374151" : "#d1d5db",
                      fontStyle: draft.bio || w.bio ? "normal" : "italic",
                      lineHeight: "1.7", margin: 0 }}>
                      {prof.bio ?? w.bio ?? "No bio yet."}
                    </p>
                  )}
                </div>

                {/* ── Services ── */}
                <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                  borderRadius: "14px", padding: "18px 20px", marginBottom: "12px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                    fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                    color: "#9ca3af", marginBottom: "12px" }}>Services Offered</div>
                  {isEditing ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {WALKER_SERVICES.map(svc => {
                        const active = (draft.services || []).includes(svc.id);
                        return (
                          <button key={svc.id}
                            onClick={() => setEditingWalker(prev => ({
                              ...prev,
                              services: active
                                ? (prev.services || []).filter(s => s !== svc.id)
                                : [...(prev.services || []), svc.id],
                            }))}
                            style={{ display: "flex", alignItems: "center", gap: "10px",
                              padding: "10px 14px", borderRadius: "10px", cursor: "pointer",
                              border: `1.5px solid ${active ? svc.border : "#e4e7ec"}`,
                              background: active ? svc.bg : "#f9fafb",
                              textAlign: "left" }}>
                            <span style={{ fontSize: "20px", flexShrink: 0 }}>{svc.icon}</span>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 600, color: active ? svc.color : "#6b7280", flex: 1 }}>
                              {svc.label}
                            </span>
                            <span style={{ fontSize: "17px", color: active ? svc.color : "#d1d5db" }}>
                              {active ? "✓" : "○"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {(prof.services || []).length === 0 ? (
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#d1d5db", fontStyle: "italic" }}>No services assigned — click Edit to add.</div>
                      ) : (
                        WALKER_SERVICES.filter(s => (prof.services || []).includes(s.id)).map(svc => (
                          <span key={svc.id} style={{ display: "inline-flex", alignItems: "center",
                            gap: "6px", padding: "6px 12px", borderRadius: "20px",
                            border: `1.5px solid ${svc.border}`,
                            background: svc.bg, fontFamily: "'DM Sans', sans-serif",
                            fontSize: "14px", fontWeight: 600, color: svc.color }}>
                            {svc.icon} {svc.label}
                          </span>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* ── Delete Walker ── */}
                {!isConfirmingDelete ? (
                  <button
                    onClick={() => setConfirmDeleteWalkerId(w.id)}
                    style={{ width: "100%", padding: "12px", borderRadius: "12px",
                      border: "1.5px solid #fecaca", background: "#fff",
                      color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", fontWeight: 600, cursor: "pointer",
                      marginBottom: "12px" }}>
                    🗑 Remove Walker
                  </button>
                ) : (
                  <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca",
                    borderRadius: "14px", padding: "18px 20px", marginBottom: "12px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                      fontSize: "16px", color: "#dc2626", marginBottom: "8px" }}>
                      Remove {prof.preferredName || w.name}?
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#374151", lineHeight: "1.6", marginBottom: "16px" }}>
                      This will remove them from the active walker roster and unassign all their upcoming walks — those walks will move to Unassigned. Their completed walk history, earnings, and contribution to revenue KPIs will be preserved.
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={deleteWalker}
                        style={{ flex: 1, padding: "11px", borderRadius: "9px", border: "none",
                          background: "#dc2626", color: "#fff",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: 700, cursor: "pointer" }}>
                        Yes, Remove Walker
                      </button>
                      <button onClick={() => setConfirmDeleteWalkerId(null)}
                        style={{ padding: "11px 18px", borderRadius: "9px",
                          border: "1.5px solid #e4e7ec", background: "#fff",
                          color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

              </div>
            );
          }

          // ── Walker list view ──────────────────────────────────────────────
          const AVATAR_OPTIONS = ["🐾","🌻","⛳","🦮","🐕","🌿","🎾","🏃","⭐","🌟","🦺","🎯"];
          const COLOR_OPTIONS = [
            { label: "Forest", value: "#C4541A" }, { label: "Navy", value: "#3D6B7A" },
            { label: "Amber", value: "#b45309" },  { label: "Plum", value: "#7A4D6E" },
            { label: "Slate", value: "#475569" },  { label: "Rose", value: "#be123c" },
            { label: "Teal", value: "#0f766e" },   { label: "Indigo", value: "#4338ca" },
          ];

          return (
            <div className="fade-up">
              {/* Header row with Add Walker button */}
              <div style={{ display: "flex", alignItems: "flex-start",
                justifyContent: "space-between", marginBottom: "6px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                  fontWeight: 600, color: "#111827" }}>Walker Profiles</div>
                <button
                  onClick={() => setShowAddWalker(v => !v)}
                  style={{ padding: "9px 18px", borderRadius: "10px", border: "none",
                    background: showAddWalker ? "#e4e7ec" : "#C4541A", color: showAddWalker ? "#374151" : "#fff",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                    flexShrink: 0, marginTop: "4px" }}>
                  {showAddWalker ? "✕ Cancel" : "+ Add Walker"}
                </button>
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
                marginBottom: "12px" }}>Click a walker to view and edit their full profile.</p>

              {/* Search */}
              <div style={{ position: "relative", marginBottom: "20px" }}>
                <span style={{ position: "absolute", left: "12px", top: "50%",
                  transform: "translateY(-50%)", fontSize: "15px", pointerEvents: "none" }}>🔍</span>
                <input value={walkerSearch} onChange={e => setWalkerSearch(e.target.value)}
                  placeholder="Search walkers by name or email…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 36px",
                    borderRadius: "10px", border: "1.5px solid #e4e7ec",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#111827", outline: "none", background: "#fff" }} />
                {walkerSearch && (
                  <button onClick={() => setWalkerSearch("")}
                    style={{ position: "absolute", right: "10px", top: "50%",
                      transform: "translateY(-50%)", background: "none", border: "none",
                      cursor: "pointer", color: "#9ca3af", fontSize: "16px", lineHeight: 1 }}>✕</button>
                )}
              </div>

              {/* ── Add Walker form ── */}
              {showAddWalker && (() => {
                const blankWalker = {
                  name: "", email: "", years: "",
                  bio: "", avatar: "🐾", color: "#C4541A",
                };
                // Use a ref-like approach: keep form state in a local component
                // Since we're inside an IIFE render, we'll use a dedicated sub-component pattern
                // by rendering an inline form component stored in state.
                // Instead, we add the state to the parent scope above and pass it down.
                // For simplicity, we render the form using the parent's walkerForm state:
                const wf = walkerForm;
                const wfErrors = walkerFormErrors;
                const iStyle = (err) => ({
                  width: "100%", padding: "10px 13px", borderRadius: "9px",
                  border: `1.5px solid ${err ? "#ef4444" : "#e4e7ec"}`,
                  background: "#fff", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", color: "#111827", outline: "none",
                });
                const labelStyle = {
                  display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
                  color: "#9ca3af", marginBottom: "5px",
                };
                return (
                  <div style={{ background: "#fff", border: "1.5px solid #8B5E3C33",
                    borderRadius: "16px", padding: "22px 20px", marginBottom: "20px",
                    boxShadow: "0 2px 12px rgba(26,107,74,0.07)" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                      fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                      color: "#9ca3af", marginBottom: "18px" }}>New Walker</div>

                    <div style={{ marginBottom: "12px" }}>
                      <label style={labelStyle}>Full Name *</label>
                      <input value={wf.name} onChange={e => setWalkerForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Jane Smith" style={iStyle(wfErrors.name)} />
                      {wfErrors.name && <div style={{ color: "#ef4444", fontSize: "15px", marginTop: "3px", fontFamily: "'DM Sans', sans-serif" }}>{wfErrors.name}</div>}
                    </div>

                    <div style={{ marginBottom: "12px" }}>
                      <label style={labelStyle}>Email * (login)</label>
                      <input type="email" value={wf.email} onChange={e => setWalkerForm(f => ({ ...f, email: e.target.value }))}
                        placeholder="jane@lonestarbark.com" style={iStyle(wfErrors.email)} />
                      {wfErrors.email && <div style={{ color: "#ef4444", fontSize: "15px", marginTop: "3px", fontFamily: "'DM Sans', sans-serif" }}>{wfErrors.email}</div>}
                      <div style={{ marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                        📧 They'll receive an email with a link to set their password.
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                      <div>
                        <label style={labelStyle}>Years Experience</label>
                        <input type="number" min="0" value={wf.years} onChange={e => setWalkerForm(f => ({ ...f, years: e.target.value }))}
                          placeholder="0" style={iStyle(false)} />
                      </div>
                      <div>
                        <label style={labelStyle}>Avatar</label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "2px" }}>
                          {AVATAR_OPTIONS.map(a => (
                            <button key={a} onClick={() => setWalkerForm(f => ({ ...f, avatar: a }))}
                              style={{ width: "34px", height: "34px", borderRadius: "8px", fontSize: "18px",
                                border: wf.avatar === a ? "2px solid #8B5E3C" : "1.5px solid #e4e7ec",
                                background: wf.avatar === a ? "#FDF5EC" : "#f9fafb", cursor: "pointer" }}>
                              {a}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: "12px" }}>
                      <label style={labelStyle}>Color</label>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {COLOR_OPTIONS.map(c => (
                          <button key={c.value} onClick={() => setWalkerForm(f => ({ ...f, color: c.value }))}
                            title={c.label}
                            style={{ width: "28px", height: "28px", borderRadius: "50%", background: c.value,
                              border: wf.color === c.value ? "3px solid #111827" : "2px solid transparent",
                              cursor: "pointer", outline: wf.color === c.value ? `2px solid ${c.value}` : "none",
                              outlineOffset: "2px" }} />
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: "16px" }}>
                      <label style={labelStyle}>Bio (optional)</label>
                      <textarea value={wf.bio} onChange={e => setWalkerForm(f => ({ ...f, bio: e.target.value }))}
                        placeholder="A brief intro for the team and landing page…" rows={3}
                        style={{ ...iStyle(false), resize: "vertical", lineHeight: "1.6" }} />
                    </div>

                    <div style={{ marginBottom: "16px" }}>
                      <label style={labelStyle}>Services Offered</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginTop: "4px" }}>
                        {WALKER_SERVICES.map(svc => {
                          const active = (wf.services || []).includes(svc.id);
                          return (
                            <button key={svc.id} onClick={() => setWalkerForm(f => ({
                              ...f,
                              services: active
                                ? (f.services || []).filter(s => s !== svc.id)
                                : [...(f.services || []), svc.id],
                            }))} style={{
                              display: "flex", alignItems: "center", gap: "10px",
                              padding: "9px 12px", borderRadius: "9px", textAlign: "left",
                              border: `1.5px solid ${active ? svc.border : "#e4e7ec"}`,
                              background: active ? svc.bg : "#fff",
                              cursor: "pointer", transition: "all 0.12s", width: "100%",
                            }}>
                              <span style={{ fontSize: "16px" }}>{svc.icon}</span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: active ? 600 : 400,
                                color: active ? svc.color : "#6b7280", flex: 1 }}>
                                {svc.label}
                              </span>
                              {active && <span style={{ fontSize: "15px", fontWeight: 700,
                                color: svc.color }}>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button onClick={() => {
                      // Validate
                      const errs = {};
                      if (!wf.name.trim()) errs.name = "Required";
                      const emailKey = wf.email.trim().toLowerCase();
                      if (!emailKey || !emailKey.includes("@")) errs.email = "Valid email required";
                      else if (Object.values(walkerProfiles).some(p => !p.deleted && p.email?.toLowerCase() === emailKey)) errs.email = "Email already in use";
                      if (Object.keys(errs).length) { setWalkerFormErrors(errs); return; }

                      // Generate a new unique ID beyond the built-in range
                      const existingIds = getAllWalkers(walkerProfiles).map(w => w.id);
                      const newId = Math.max(...existingIds, 100) + 1;

                      const derivedRole = (wf.services || []).length > 0
                        ? WALKER_SERVICES.filter(s => (wf.services || []).includes(s.id)).map(s => s.label).join(" / ")
                        : "Dog Walker";

                      const newProf = {
                        id: newId,
                        isCustom: true,
                        name: wf.name.trim(),
                        preferredName: wf.name.trim(),
                        role: derivedRole,
                        years: parseInt(wf.years) || 0,
                        avatar: wf.avatar,
                        color: wf.color,
                        bio: wf.bio.trim(),
                        email: emailKey,
                        mustSetPin: true,
                        phone: "", address: "", preferredAvailability: "",
                        services: wf.services || [],
                      };

                      const updatedProfiles = { ...walkerProfiles, [newId]: newProf };
                      setWalkerProfiles(updatedProfiles);
                      saveWalkerProfiles(updatedProfiles);

                      // Inject immediately into runtime so they can log in + appear everywhere
                      injectCustomWalkers(updatedProfiles);

                      // Send invite email so the walker can set their password
                      inviteWalkerAuth(emailKey, wf.name.trim());

                      logAuditEvent({ adminId: admin.id, adminName: admin.name,
                        action: "walker_added", entityType: "walker", entityId: newId,
                        details: { walkerName: newProf.name, email: newProf.email, role: newProf.role } });

                      setWalkerForm({ name: "", email: "", years: "", bio: "", avatar: "🐾", color: "#C4541A", services: [] });
                      setWalkerFormErrors({});
                      setShowAddWalker(false);
                    }} style={{
                      width: "100%", padding: "13px", borderRadius: "10px", border: "none",
                      background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "16px", fontWeight: 600, cursor: "pointer",
                    }}>
                      Create Walker Account →
                    </button>
                  </div>
                );
              })()}

              {getAllWalkers(walkerProfiles).filter(w => {
                if (!walkerSearch) return true;
                const q = walkerSearch.toLowerCase();
                return (w.name || "").toLowerCase().includes(q)
                  || ((walkerProfiles[w.id]?.email) || "").toLowerCase().includes(q);
              }).map(w => {
                const prof = walkerProfiles[w.id] || {};
                const walkerUpcoming = upcoming.filter(b => b.form?.walker === w.name);
                const walkerCompleted = completedBookings.filter(b => b.form?.walker === w.name);
                const earnings = Math.round(walkerCompleted.reduce((s, b) => s + getWalkerPayout(b), 0));
                const hasPhone = !!(prof.phone);
                const hasAddress = !!(prof.address);
                return (
                  <button key={w.id}
                    onClick={() => { setSelectedWalkerId(w.id); setEditingWalker(null); }}
                    className="hover-card"
                    style={{ width: "100%", background: "#fff",
                      border: `1.5px solid ${w.color}33`, borderRadius: "16px",
                      padding: "18px 20px", marginBottom: "12px",
                      cursor: "pointer", textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <div style={{ width: "52px", height: "52px", borderRadius: "50%",
                        background: w.color + "18", border: `2px solid ${w.color}44`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "24px", flexShrink: 0 }}>{w.avatar}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "15px", color: "#111827", marginBottom: "2px" }}>
                          {prof.preferredName || w.name}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: w.color, marginBottom: "4px" }}>
                          {(prof.services || []).length > 0
                            ? WALKER_SERVICES.filter(s => prof.services.includes(s.id)).map(s => s.label).join(" / ")
                            : w.role.replace(/ & /g, " / ")
                          } · {w.years} yrs
                        </div>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {(() => {
                            const isVisible = prof.showOnTeamPage ?? true;
                            return (
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                                fontWeight: 600,
                                color: isVisible ? "#C4541A" : "#6b7280",
                                background: isVisible ? "#FDF5EC" : "#f3f4f6",
                                border: `1px solid ${isVisible ? "#D4A843" : "#e4e7ec"}`,
                                borderRadius: "4px", padding: "1px 6px" }}>
                                {isVisible ? "👁 Visible" : "🚫 Hidden"}
                              </span>
                            );
                          })()}
                          {hasPhone && (
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                              color: "#059669", background: "#FDF5EC", border: "1px solid #EDD5A8",
                              borderRadius: "4px", padding: "1px 6px" }}>📞 on file</span>
                          )}
                          {hasAddress && (
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                              color: "#3D6B7A", background: "#EBF4F6", border: "1px solid #8ECAD4",
                              borderRadius: "4px", padding: "1px 6px" }}>📍 on file</span>
                          )}
                          {prof.pendingBio && prof.pendingBio !== prof.bio && (
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                              color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a",
                              borderRadius: "4px", padding: "1px 6px" }}>⏳ bio pending</span>
                          )}
                          {!hasPhone && !hasAddress && !prof.pendingBio && (
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                              color: "#d97706", background: "#fffbeb", border: "1px solid #fde68a",
                              borderRadius: "4px", padding: "1px 6px" }}>⚠️ profile incomplete</span>
                          )}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700,
                          color: w.color, whiteSpace: "nowrap" }}>
                          {walkerUpcoming.length} up
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700,
                          color: "#059669", whiteSpace: "nowrap" }}>
                          {walkerCompleted.length} done
                        </div>
                        <div style={{ fontSize: "14px", color: "#d1d5db" }}>›</div>
                      </div>
                    </div>
                  </button>
                );
              })}

              {/* ── Potential Walkers banner ── */}
              <button onClick={async () => {
                changeTab("applications");
                setSelectedApp(null);
                if (applications.length === 0) {
                  setAppsLoading(true);
                  try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/applications?order=created_at.desc`, {
                      headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
                    });
                    const data = await res.json();
                    setApplications(Array.isArray(data) ? data : []);
                  } catch { setApplications([]); }
                  setAppsLoading(false);
                }
              }} style={{
                width: "100%", marginTop: "16px", padding: "16px 20px",
                borderRadius: "14px", border: "1.5px dashed #D4A87A",
                background: "#FDF5EC", cursor: "pointer", textAlign: "left",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                    fontSize: "16px", color: "#C4541A", marginBottom: "3px" }}>
                    🐾 Potential Walkers
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                    {applications.filter(a => a.status === "pending").length > 0
                      ? `${applications.filter(a => a.status === "pending").length} pending review`
                      : "Review incoming walker applications"}
                  </div>
                </div>
                <span style={{ color: "#D4A843", fontSize: "20px" }}>›</span>
              </button>

            </div>
          );
        })()}

        {/* ── Applications view ── */}
        {showApplications && tab === "walkers" && (() => {
          const statusColor = (s) => s === "approved" ? "#059669" : s === "declined" ? "#dc2626" : s === "reviewed" ? "#4338ca" : "#b45309";
          const statusBg   = (s) => s === "approved" ? "#FDF5EC"  : s === "declined" ? "#fef2f2"  : s === "reviewed" ? "#eef2ff" : "#fffbeb";
          const statusLabel = (s) => s === "approved" ? "Approved" : s === "declined" ? "Declined" : s === "reviewed" ? "Reviewed" : "Pending";

          const createWalkerFromApplication = async (app) => {
            const emailKey = (app.email || "").trim().toLowerCase();
            const alreadyExists = Object.values(walkerProfiles).some(
              p => p.email?.toLowerCase() === emailKey
            );
            if (alreadyExists) return;
            const newId = Date.now();
            const fullName = `${app.first_name || ""} ${app.last_name || ""}`.trim();
            const newProfile = {
              id: newId,
              isCustom: true,
              name: fullName,
              preferredName: fullName,
              email: emailKey,
              phone: app.phone || "",
              role: "Dog Walker",
              years: parseInt(app.exp_years) || 0,
              bio: app.exp_desc || "",
              color: "#6b7280",
              avatar: "🐾",
              mustSetPin: true,
              pin: null,
              services: [],
              availability: {},
              createdAt: new Date().toISOString(),
            };
            const updated = { ...walkerProfiles, [newId]: newProfile };
            setWalkerProfiles(updated);
            await saveWalkerProfiles(updated);
            injectCustomWalkers(updated);
            // Provision Supabase Auth account so they can log in via PIN
            createWalkerAuthAccount(emailKey, fullName);
          };

          const updateStatus = async (id, status) => {
            await fetch(`${SUPABASE_URL}/rest/v1/applications?id=eq.${id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                "Prefer": "return=minimal",
              },
              body: JSON.stringify({ status }),
            });
            setApplications(prev => prev.map(a => a.id === id ? { ...a, status } : a));
            if (selectedApp?.id === id) setSelectedApp(a => ({ ...a, status }));
            if (status === "approved") {
              const app = applications.find(a => a.id === id);
              if (app) await createWalkerFromApplication(app);
            }
          };

          if (selectedApp) {
            const a = selectedApp;
            const Section = ({ title, children }) => (
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "14px", padding: "18px 20px", marginBottom: "12px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                  fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                  color: "#9ca3af", marginBottom: "14px" }}>{title}</div>
                {children}
              </div>
            );
            const Row = ({ label, value }) => value ? (
              <div style={{ display: "flex", gap: "12px", marginBottom: "10px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                  color: "#9ca3af", width: "120px", flexShrink: 0 }}>{label}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#111827", flex: 1 }}>{value}</div>
              </div>
            ) : null;

            return (
              <div className="fade-up">
                <button onClick={() => setSelectedApp(null)} style={{ background: "none", border: "none",
                  color: "#6b7280", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
                  ← Back to Applications
                </button>

                <div style={{ display: "flex", alignItems: "flex-start",
                  justifyContent: "space-between", marginBottom: "20px", gap: "12px" }}>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                      fontWeight: 600, color: "#111827" }}>{a.first_name} {a.last_name}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#6b7280", marginTop: "2px" }}>
                      Applied {new Date(a.created_at).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
                    </div>
                  </div>
                  <span style={{ padding: "5px 12px", borderRadius: "20px", fontSize: "16px",
                    fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                    color: statusColor(a.status), background: statusBg(a.status),
                    border: `1px solid ${statusColor(a.status)}44`, flexShrink: 0 }}>
                    {statusLabel(a.status)}
                  </span>
                </div>

                <Section title="Contact">
                  <Row label="Email"   value={a.email} />
                  <Row label="Phone"   value={a.phone} />
                  <Row label="City"    value={`${a.city || ""}${a.zip ? `, ${a.zip}` : ""}`} />
                </Section>

                <Section title="Experience">
                  <Row label="Dog Experience" value={a.has_dog_exp === true ? "Yes" : a.has_dog_exp === false ? "No (eager to learn)" : "—"} />
                  {a.exp_years && <Row label="Years" value={a.exp_years} />}
                  {a.exp_desc  && <Row label="Description" value={a.exp_desc} />}
                  <Row label="Pet First Aid" value={a.first_aid ? "✓ Yes" : "No"} />
                  <Row label="Pet CPR"       value={a.pet_cpr   ? "✓ Yes" : "No"} />
                </Section>

                <Section title="References">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    {[{name:a.ref1_name,phone:a.ref1_phone,rel:a.ref1_rel},
                      {name:a.ref2_name,phone:a.ref2_phone,rel:a.ref2_rel}].map((ref,i) => ref.name && (
                      <div key={i} style={{ background: "#f9fafb", borderRadius: "10px",
                        padding: "12px 14px", border: "1.5px solid #e4e7ec" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "15px", color: "#111827", marginBottom: "4px" }}>{ref.name}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>{ref.phone}</div>
                        {ref.rel && <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#9ca3af", marginTop: "2px" }}>{ref.rel}</div>}
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Availability">
                  {a.days?.length > 0 && (
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", marginBottom: "6px" }}>Days</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {a.days.map(d => (
                          <span key={d} style={{ padding: "3px 10px", borderRadius: "20px",
                            background: "#FDF5EC", border: "1px solid #D4A87A",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#C4541A" }}>{d}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {a.times?.length > 0 && (
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", marginBottom: "6px" }}>Time Windows</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {a.times.map(t => (
                          <span key={t} style={{ padding: "3px 10px", borderRadius: "20px",
                            background: "#EBF4F6", border: "1px solid #8ECAD4",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#3D6B7A" }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {a.hours_per_week && <Row label="Hours/week" value={a.hours_per_week} />}
                  {a.service_interests?.length > 0 && (
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", marginBottom: "6px" }}>Interested In</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {WALKER_SERVICES.filter(s => a.service_interests.includes(s.id)).map(s => (
                          <span key={s.id} style={{ padding: "3px 10px", borderRadius: "20px",
                            background: s.bg, border: `1px solid ${s.border}`,
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: s.color }}>
                            {s.icon} {s.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </Section>

                {a.message && (
                  <Section title="Additional Notes">
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#374151", lineHeight: "1.7", margin: 0 }}>{a.message}</p>
                  </Section>
                )}

                {a.w9_url && (
                  <Section title="W-9 Form">
                    <a href={a.w9_url} target="_blank" rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: "8px",
                        padding: "10px 16px", borderRadius: "9px", border: "1.5px solid #D4A87A",
                        background: "#FDF5EC", color: "#C4541A",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 600, textDecoration: "none" }}>
                      📄 View W-9 Document
                    </a>
                  </Section>
                )}

                {/* Action buttons */}
                {a.status === "pending" && (
                  <>
                    <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                      <button onClick={() => updateStatus(a.id, "approved")}
                        style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "none",
                          background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
                        ✓ Approve Application
                      </button>
                      <button onClick={() => updateStatus(a.id, "declined")}
                        style={{ flex: 1, padding: "14px", borderRadius: "12px",
                          border: "1.5px solid #fca5a5", background: "#fef2f2",
                          color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
                        ✕ Decline
                      </button>
                    </div>
                    <button onClick={() => updateStatus(a.id, "reviewed")}
                      style={{ width: "100%", padding: "12px", borderRadius: "12px",
                        border: "1.5px solid #c7d2fe", background: "#eef2ff",
                        color: "#4338ca", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", fontWeight: 600, cursor: "pointer", marginTop: "10px" }}>
                      👁 Mark as Reviewed (Not Hiring)
                    </button>
                  </>
                )}
                {a.status !== "pending" && (
                  <button onClick={() => updateStatus(a.id, "pending")}
                    style={{ width: "100%", padding: "12px", borderRadius: "12px",
                      border: "1.5px solid #e4e7ec", background: "#fff",
                      color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "16px", cursor: "pointer", marginTop: "8px" }}>
                    ↩ Reset to Pending
                  </button>
                )}
              </div>
            );
          }

          // Application list view
          return (
            <div className="fade-up">
              <button onClick={() => setShowApplications(false)} style={{ background: "none", border: "none",
                color: "#6b7280", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
                ← Back to Walkers
              </button>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Potential Walkers</div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#6b7280", marginBottom: "12px" }}>
                Incoming applications from the Join the Team form.
              </p>

              {/* Search */}
              <div style={{ position: "relative", marginBottom: "20px" }}>
                <span style={{ position: "absolute", left: "12px", top: "50%",
                  transform: "translateY(-50%)", fontSize: "15px", pointerEvents: "none" }}>🔍</span>
                <input value={appSearch} onChange={e => setAppSearch(e.target.value)}
                  placeholder="Search applicants by name or email…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 36px",
                    borderRadius: "10px", border: "1.5px solid #e4e7ec",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#111827", outline: "none", background: "#fff" }} />
                {appSearch && (
                  <button onClick={() => setAppSearch("")}
                    style={{ position: "absolute", right: "10px", top: "50%",
                      transform: "translateY(-50%)", background: "none", border: "none",
                      cursor: "pointer", color: "#9ca3af", fontSize: "16px", lineHeight: 1 }}>✕</button>
                )}
              </div>

              {appsLoading ? (
                <div style={{ textAlign: "center", padding: "40px",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                  Loading applications…
                </div>
              ) : applications.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 24px",
                  background: "#f9fafb", borderRadius: "16px", border: "1.5px solid #e4e7ec" }}>
                  <div style={{ fontSize: "32px", marginBottom: "12px" }}>📭</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>
                    No applications yet.
                  </div>
                </div>
              ) : (
                <>
                  {/* Filter tabs */}
                  {(() => {
                    const counts = { all: applications.length,
                      pending:  applications.filter(a => a.status === "pending").length,
                      approved: applications.filter(a => a.status === "approved").length,
                      reviewed: applications.filter(a => a.status === "reviewed").length,
                      declined: applications.filter(a => a.status === "declined").length };
                    return (
                      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
                        {[["all","All"],["pending","Pending"],["approved","Approved"],["reviewed","Reviewed"],["declined","Declined"]].map(([k,l]) => {
                          const active = (window._appFilter || "all") === k;
                          return (
                            <button key={k} onClick={() => { window._appFilter = k; setApplications(a => [...a]); }}
                              style={{ padding: "5px 14px", borderRadius: "20px", cursor: "pointer",
                                fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                fontWeight: active ? 700 : 400,
                                border: `1.5px solid ${active ? "#C4541A" : "#e4e7ec"}`,
                                background: active ? "#C4541A" : "#fff",
                                color: active ? "#fff" : "#6b7280" }}>
                              {l} {counts[k] > 0 && `(${counts[k]})`}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {applications
                    .filter(a => !window._appFilter || window._appFilter === "all" || a.status === window._appFilter)
                    .map(a => (
                    <button key={a.id} onClick={() => setSelectedApp(a)}
                      style={{ width: "100%", background: "#fff", border: "1.5px solid #e4e7ec",
                        borderRadius: "14px", padding: "16px 18px", marginBottom: "10px",
                        cursor: "pointer", textAlign: "left", display: "flex",
                        alignItems: "center", gap: "14px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center",
                          gap: "10px", marginBottom: "4px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                            fontSize: "16px", color: "#111827" }}>
                            {a.first_name} {a.last_name}
                          </div>
                          <span style={{ padding: "2px 9px", borderRadius: "20px", fontSize: "15px",
                            fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                            color: statusColor(a.status), background: statusBg(a.status),
                            border: `1px solid ${statusColor(a.status)}44` }}>
                            {statusLabel(a.status)}
                          </span>
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                          {a.email} · {a.city}{a.zip ? `, ${a.zip}` : ""}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#9ca3af", marginTop: "3px" }}>
                          Applied {new Date(a.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                          {a.has_dog_exp ? " · Has experience" : " · No prior exp"}
                          {a.w9_url ? " · W-9 on file ✓" : ""}
                        </div>
                      </div>
                      <span style={{ color: "#d1d5db", fontSize: "18px" }}>›</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          );
        })()}
        {tab === "applications" && (() => {
          // Load applications when tab first opens
          if (!appsLoading && applications.length === 0) {
            setAppsLoading(true);
            fetch(`${SUPABASE_URL}/rest/v1/applications?order=created_at.desc`, {
              headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
            }).then(r => r.json()).then(data => {
              setApplications(Array.isArray(data) ? data : []);
              setAppsLoading(false);
            }).catch(() => setAppsLoading(false));
          }

          const statusColor = (s) => s === "approved" ? "#059669" : s === "declined" ? "#dc2626" : s === "reviewed" ? "#4338ca" : "#b45309";
          const statusBg   = (s) => s === "approved" ? "#FDF5EC"  : s === "declined" ? "#fef2f2"  : s === "reviewed" ? "#eef2ff" : "#fffbeb";
          const statusLabel = (s) => s === "approved" ? "Approved" : s === "declined" ? "Declined" : s === "reviewed" ? "Reviewed" : "Pending";

          const createWalkerFromApplication = async (app) => {
            const emailKey = (app.email || "").trim().toLowerCase();
            const alreadyExists = Object.values(walkerProfiles).some(
              p => p.email?.toLowerCase() === emailKey
            );
            if (alreadyExists) return;
            const newId = Date.now();
            const fullName = `${app.first_name || ""} ${app.last_name || ""}`.trim();
            const newProfile = {
              id: newId,
              isCustom: true,
              name: fullName,
              preferredName: fullName,
              email: emailKey,
              phone: app.phone || "",
              role: "Dog Walker",
              years: parseInt(app.exp_years) || 0,
              bio: app.exp_desc || "",
              color: "#6b7280",
              avatar: "🐾",
              mustSetPin: true,
              pin: null,
              services: [],
              availability: {},
              createdAt: new Date().toISOString(),
            };
            const updated = { ...walkerProfiles, [newId]: newProfile };
            setWalkerProfiles(updated);
            await saveWalkerProfiles(updated);
            injectCustomWalkers(updated);
            // Provision Supabase Auth account so they can log in via PIN
            createWalkerAuthAccount(emailKey, fullName);
          };

          const updateStatus = async (id, status) => {
            await fetch(`${SUPABASE_URL}/rest/v1/applications?id=eq.${id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                "Prefer": "return=minimal",
              },
              body: JSON.stringify({ status }),
            });
            setApplications(prev => prev.map(a => a.id === id ? { ...a, status } : a));
            if (selectedApp?.id === id) setSelectedApp(prev => ({ ...prev, status }));
            if (status === "approved") {
              const app = applications.find(a => a.id === id);
              if (app) await createWalkerFromApplication(app);
            }
          };

          if (selectedApp) {
            const a = selectedApp;
            const Section = ({ title, children }) => (
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "14px", padding: "18px 20px", marginBottom: "12px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                  fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                  color: "#9ca3af", marginBottom: "14px" }}>{title}</div>
                {children}
              </div>
            );
            const Row = ({ label, value }) => value ? (
              <div style={{ display: "flex", gap: "12px", marginBottom: "10px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                  color: "#9ca3af", width: "120px", flexShrink: 0 }}>{label}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#111827", flex: 1 }}>{value}</div>
              </div>
            ) : null;

            return (
              <div className="fade-up">
                <button onClick={() => setSelectedApp(null)} style={{ background: "none", border: "none",
                  color: "#6b7280", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
                  ← Back to Applications
                </button>
                <div style={{ display: "flex", alignItems: "flex-start",
                  justifyContent: "space-between", marginBottom: "20px", gap: "12px" }}>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                      fontWeight: 600, color: "#111827" }}>{a.first_name} {a.last_name}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#6b7280", marginTop: "2px" }}>
                      Applied {new Date(a.created_at).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
                    </div>
                  </div>
                  <span style={{ padding: "5px 12px", borderRadius: "20px", fontSize: "16px",
                    fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                    color: statusColor(a.status), background: statusBg(a.status),
                    border: `1px solid ${statusColor(a.status)}44`, flexShrink: 0 }}>
                    {statusLabel(a.status)}
                  </span>
                </div>
                <Section title="Contact">
                  <Row label="Email" value={a.email} />
                  <Row label="Phone" value={a.phone} />
                  <Row label="City"  value={`${a.city || ""}${a.zip ? `, ${a.zip}` : ""}`} />
                </Section>
                <Section title="Experience">
                  <Row label="Dog Experience" value={a.has_dog_exp === true ? "Yes" : a.has_dog_exp === false ? "No (eager to learn)" : "—"} />
                  {a.exp_years && <Row label="Years" value={a.exp_years} />}
                  {a.exp_desc  && <Row label="Description" value={a.exp_desc} />}
                  <Row label="Pet First Aid" value={a.first_aid ? "✓ Yes" : "No"} />
                  <Row label="Pet CPR"       value={a.pet_cpr   ? "✓ Yes" : "No"} />
                </Section>
                <Section title="References">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    {[{name:a.ref1_name,phone:a.ref1_phone,rel:a.ref1_rel},
                      {name:a.ref2_name,phone:a.ref2_phone,rel:a.ref2_rel}].map((ref,i) => ref?.name && (
                      <div key={i} style={{ background: "#f9fafb", borderRadius: "10px",
                        padding: "12px 14px", border: "1.5px solid #e4e7ec" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "15px", color: "#111827", marginBottom: "4px" }}>{ref.name}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>{ref.phone}</div>
                        {ref.rel && <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: "#9ca3af", marginTop: "2px" }}>{ref.rel}</div>}
                      </div>
                    ))}
                  </div>
                </Section>
                <Section title="Availability">
                  {a.days?.length > 0 && (
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", marginBottom: "6px" }}>Days</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {a.days.map(d => (
                          <span key={d} style={{ padding: "3px 10px", borderRadius: "20px",
                            background: "#FDF5EC", border: "1px solid #D4A87A",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#C4541A" }}>{d}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {a.times?.length > 0 && (
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", marginBottom: "6px" }}>Time Windows</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {a.times.map(t => (
                          <span key={t} style={{ padding: "3px 10px", borderRadius: "20px",
                            background: "#EBF4F6", border: "1px solid #8ECAD4",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#3D6B7A" }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {a.hours_per_week && <Row label="Hours/week" value={a.hours_per_week} />}
                  {a.service_interests?.length > 0 && (
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", marginBottom: "6px" }}>Interested In</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {WALKER_SERVICES.filter(s => a.service_interests?.includes(s.id)).map(s => (
                          <span key={s.id} style={{ padding: "3px 10px", borderRadius: "20px",
                            background: s.bg, border: `1px solid ${s.border}`,
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: s.color }}>
                            {s.icon} {s.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </Section>
                {a.message && (
                  <Section title="Additional Notes">
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#374151", lineHeight: "1.7", margin: 0 }}>{a.message}</p>
                  </Section>
                )}
                {a.w9_url && (
                  <Section title="W-9 Form">
                    <a href={a.w9_url} target="_blank" rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: "8px",
                        padding: "10px 16px", borderRadius: "9px", border: "1.5px solid #D4A87A",
                        background: "#FDF5EC", color: "#C4541A",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 600, textDecoration: "none" }}>
                      📄 View W-9 Document
                    </a>
                  </Section>
                )}
                {a.status === "pending" && (
                  <>
                    <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                      <button onClick={() => updateStatus(a.id, "approved")}
                        style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "none",
                          background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
                        ✓ Approve Application
                      </button>
                      <button onClick={() => updateStatus(a.id, "declined")}
                        style={{ flex: 1, padding: "14px", borderRadius: "12px",
                          border: "1.5px solid #fca5a5", background: "#fef2f2",
                          color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
                        ✕ Decline
                      </button>
                    </div>
                    <button onClick={() => updateStatus(a.id, "reviewed")}
                      style={{ width: "100%", padding: "12px", borderRadius: "12px",
                        border: "1.5px solid #c7d2fe", background: "#eef2ff",
                        color: "#4338ca", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", fontWeight: 600, cursor: "pointer", marginTop: "10px" }}>
                      👁 Mark as Reviewed (Not Hiring)
                    </button>
                  </>
                )}
                {a.status !== "pending" && (
                  <button onClick={() => updateStatus(a.id, "pending")}
                    style={{ width: "100%", padding: "12px", borderRadius: "12px",
                      border: "1.5px solid #e4e7ec", background: "#fff",
                      color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "16px", cursor: "pointer", marginTop: "8px" }}>
                    ↩ Reset to Pending
                  </button>
                )}
              </div>
            );
          }

          // Application list
          const filteredApps = appSearch
            ? applications.filter(a => {
                const q = appSearch.toLowerCase();
                return (`${a.first_name || ""} ${a.last_name || ""}`).toLowerCase().includes(q)
                  || (a.email || "").toLowerCase().includes(q)
                  || (a.city  || "").toLowerCase().includes(q);
              })
            : applications;
          const pending   = filteredApps.filter(a => a.status === "pending");
          const approved  = filteredApps.filter(a => a.status === "approved");
          const reviewed  = filteredApps.filter(a => a.status === "reviewed");
          const declined  = filteredApps.filter(a => a.status === "declined");

          const AppCard = ({ a }) => (
            <button onClick={() => setSelectedApp(a)} style={{
              width: "100%", background: "#fff", border: `1.5px solid ${statusColor(a.status)}22`,
              borderRadius: "14px", padding: "16px 18px", marginBottom: "10px",
              cursor: "pointer", textAlign: "left", display: "flex",
              alignItems: "center", justifyContent: "space-between", gap: "12px",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                    fontSize: "16px", color: "#111827" }}>{a.first_name} {a.last_name}</div>
                  <span style={{ padding: "2px 8px", borderRadius: "20px", fontSize: "16px",
                    fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                    color: statusColor(a.status), background: statusBg(a.status),
                    border: `1px solid ${statusColor(a.status)}33` }}>
                    {statusLabel(a.status)}
                  </span>
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                  {a.email} · {a.city}{a.zip ? `, ${a.zip}` : ""}
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af", marginTop: "2px" }}>
                  Applied {new Date(a.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                  {a.has_dog_exp ? " · Has exp." : " · No prior exp."}
                  {a.w9_url ? " · W-9 ✓" : ""}
                </div>
              </div>
              <span style={{ color: "#d1d5db", fontSize: "16px", flexShrink: 0 }}>›</span>
            </button>
          );

          return (
            <div className="fade-up">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: "6px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                  fontWeight: 600, color: "#111827" }}>Applications</div>
                <button onClick={() => {
                  setAppsLoading(true);
                  fetch(`${SUPABASE_URL}/rest/v1/applications?order=created_at.desc`, {
                    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
                  }).then(r => r.json()).then(data => {
                    setApplications(Array.isArray(data) ? data : []);
                    setAppsLoading(false);
                  }).catch(() => setAppsLoading(false));
                }} style={{ padding: "7px 14px", borderRadius: "9px",
                  border: "1.5px solid #e4e7ec", background: "#fff",
                  color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "16px", cursor: "pointer" }}>↺ Refresh</button>
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#6b7280", marginBottom: "12px" }}>
                Incoming applications from the Join the Team form.
              </p>

              {/* Search */}
              <div style={{ position: "relative", marginBottom: "20px" }}>
                <span style={{ position: "absolute", left: "12px", top: "50%",
                  transform: "translateY(-50%)", fontSize: "15px", pointerEvents: "none" }}>🔍</span>
                <input value={appSearch} onChange={e => setAppSearch(e.target.value)}
                  placeholder="Search applicants by name or email…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 36px",
                    borderRadius: "10px", border: "1.5px solid #e4e7ec",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#111827", outline: "none", background: "#fff" }} />
                {appSearch && (
                  <button onClick={() => setAppSearch("")}
                    style={{ position: "absolute", right: "10px", top: "50%",
                      transform: "translateY(-50%)", background: "none", border: "none",
                      cursor: "pointer", color: "#9ca3af", fontSize: "16px", lineHeight: 1 }}>✕</button>
                )}
              </div>

              {appsLoading ? (
                <div style={{ textAlign: "center", padding: "40px",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                  Loading applications…
                </div>
              ) : applications.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff",
                  borderRadius: "16px", border: "1.5px solid #e4e7ec" }}>
                  <div style={{ fontSize: "36px", marginBottom: "12px" }}>📝</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>
                    No applications yet
                  </div>
                </div>
              ) : (
                <>
                  {pending.length > 0 && (
                    <div style={{ marginBottom: "24px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                        fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                        color: "#b45309", marginBottom: "12px" }}>
                        ⏳ Pending Review ({pending.length})
                      </div>
                      {pending.map(a => <AppCard key={a.id} a={a} />)}
                    </div>
                  )}
                  {approved.length > 0 && (
                    <div style={{ marginBottom: "24px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                        fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                        color: "#059669", marginBottom: "12px" }}>
                        ✓ Approved ({approved.length})
                      </div>
                      {approved.map(a => <AppCard key={a.id} a={a} />)}
                    </div>
                  )}
                  {reviewed.length > 0 && (
                    <div style={{ marginBottom: "24px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                        fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                        color: "#4338ca", marginBottom: "12px" }}>
                        👁 Reviewed — Not Hiring ({reviewed.length})
                      </div>
                      {reviewed.map(a => <AppCard key={a.id} a={a} />)}
                    </div>
                  )}
                  {declined.length > 0 && (
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                        fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
                        color: "#dc2626", marginBottom: "12px" }}>
                        ✕ Declined ({declined.length})
                      </div>
                      {declined.map(a => <AppCard key={a.id} a={a} />)}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {tab === "assign" && (() => {
          // Filter walks
          const sortedWalks = [...upcoming].sort((a, b) => {
            const aUnassigned = !a.form?.walker;
            const bUnassigned = !b.form?.walker;
            if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
            return new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt);
          });

          const filteredWalks = sortedWalks.filter(b => {
            // Date filter — compare yyyy-mm-dd of the walk's scheduledDateTime
            if (assignDateFilter) {
              const walkDate = b.scheduledDateTime
                ? new Date(b.scheduledDateTime).toLocaleDateString("en-CA")
                : null;
              if (walkDate !== assignDateFilter) return false;
            }
            // Text search — client name, pet, walker
            if (assignSearch) {
              const q = assignSearch.toLowerCase();
              const matches =
                (b.clientName || "").toLowerCase().includes(q) ||
                (b.form?.pet || "").toLowerCase().includes(q) ||
                (b.form?.walker || "").toLowerCase().includes(q);
              if (!matches) return false;
            }
            return true;
          });

          const unassignedCount = upcoming.filter(b => !b.form?.walker).length;

          return (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "6px" }}>Assign Walks</div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
              marginBottom: "16px" }}>
              {unassignedCount > 0
                ? `${unassignedCount} ${unassignedCount === 1 ? "walk still needs" : "walks still need"} a walker.`
                : "All walks are assigned! 🎉"}
            </p>

            {/* Search + Date filter row */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
              {/* Search */}
              <div style={{ position: "relative", flex: "1 1 200px" }}>
                <span style={{ position: "absolute", left: "12px", top: "50%",
                  transform: "translateY(-50%)", fontSize: "15px", pointerEvents: "none" }}>🔍</span>
                <input
                  value={assignSearch}
                  onChange={e => setAssignSearch(e.target.value)}
                  placeholder="Search client, pet, or walker…"
                  style={{ width: "100%", boxSizing: "border-box",
                    padding: "10px 34px 10px 36px", borderRadius: "10px",
                    border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", color: "#111827", outline: "none", background: "#fff" }}
                />
                {assignSearch && (
                  <button onClick={() => setAssignSearch("")}
                    style={{ position: "absolute", right: "10px", top: "50%",
                      transform: "translateY(-50%)", background: "none", border: "none",
                      cursor: "pointer", color: "#9ca3af", fontSize: "16px", lineHeight: 1 }}>✕</button>
                )}
              </div>

              {/* Date picker */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <input
                  type="date"
                  value={assignDateFilter}
                  onChange={e => setAssignDateFilter(e.target.value)}
                  style={{ padding: "10px 12px", borderRadius: "10px",
                    border: `1.5px solid ${assignDateFilter ? "#C4541A" : "#e4e7ec"}`,
                    background: assignDateFilter ? "#FDF5EC" : "#fff",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: assignDateFilter ? "#C4541A" : "#6b7280",
                    cursor: "pointer", outline: "none" }}
                />
                {assignDateFilter && (
                  <button onClick={() => setAssignDateFilter("")}
                    style={{ position: "absolute", right: "-28px", top: "50%",
                      transform: "translateY(-50%)", background: "none", border: "none",
                      cursor: "pointer", color: "#9ca3af", fontSize: "16px", lineHeight: 1 }}>✕</button>
                )}
              </div>
            </div>

            {/* Active filter label */}
            {assignDateFilter && (
              <div style={{ marginBottom: "14px", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", color: "#C4541A", fontWeight: 600 }}>
                📅 {new Date(assignDateFilter + "T12:00:00").toLocaleDateString("en-US",
                  { weekday: "long", month: "long", day: "numeric" })}
                {" "}· {filteredWalks.length} walk{filteredWalks.length !== 1 ? "s" : ""}
              </div>
            )}

            {filteredWalks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff",
                borderRadius: "16px", border: "1.5px solid #e4e7ec" }}>
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>🔍</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>
                  No walks match your filters.
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {filteredWalks.map((b, i) => {
                  const walkerVal = b.form?.walker || "";
                  const isUnassigned = !walkerVal;
                  return (
                    <div key={i} style={{
                      background: isUnassigned ? "#fef2f2" : "#fff",
                      border: `1.5px solid ${isUnassigned ? "#fecaca" : "#e4e7ec"}`,
                      borderRadius: "14px", padding: "14px 16px",
                      display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          fontSize: "15px", color: "#111827", marginBottom: "3px", display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}>
                          {b.form?.pet || "Pet"} · {b.slot?.duration}
                          {isUnassigned && <span style={{ background: "#fecaca",
                            color: "#dc2626", fontSize: "13px", padding: "1px 6px",
                            borderRadius: "5px", fontWeight: 600 }}>UNASSIGNED</span>}
                          {b.isRecurring && <span style={{ background: "#EBF4F6",
                            color: "#2A7A90", fontSize: "13px", padding: "1px 6px",
                            borderRadius: "5px", fontWeight: 600 }}>🔁</span>}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                          color: "#6b7280" }}>{b.day}, {b.date} at {b.slot?.time}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                          color: "#9ca3af", marginTop: "2px" }}>
                          👤 {b.clientName}
                          {b.clientKeyholder && b.clientKeyholder === walkerVal && (
                            <span title={`${b.clientKeyholder} holds the key`} style={{ marginLeft: "5px" }}>🗝️</span>
                          )}
                        </div>
                      </div>
                      <select
                        value={walkerVal}
                        onChange={e => {
                          const newWalker = e.target.value;
                          const updatedClients = { ...clients };
                          const c = updatedClients[b.clientId];
                          if (c) {
                            if (b.isHandoff) {
                              // Meet & greet lives in handoffInfo, not bookings
                              updatedClients[b.clientId] = {
                                ...c,
                                handoffInfo: { ...(c.handoffInfo || {}), handoffWalker: newWalker },
                              };
                            } else {
                              updatedClients[b.clientId] = {
                                ...c,
                                bookings: (c.bookings || []).map(bk =>
                                  bk.key === b.key
                                    ? { ...bk, form: { ...bk.form, walker: newWalker } }
                                    : bk
                                ),
                              };
                            }
                            setClients(updatedClients);
                            saveClients(updatedClients);
                          }
                        }}
                        style={{ width: "100%", padding: "7px 8px", borderRadius: "9px",
                          border: `1.5px solid ${isUnassigned ? "#fca5a5" : "#e4e7ec"}`,
                          background: isUnassigned ? "#fff5f5" : "#fff",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                          color: "#111827", cursor: "pointer" }}>
                        <option value="">— Assign walker —</option>
                        {getAllWalkers(walkerProfiles).map(w => (
                          <option key={w.id} value={w.name}>{w.avatar} {w.name}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })()}

        {/* ── Schedule Walk ── */}
        {tab === "schedulewalk" && (
          <ScheduleWalkForm
            clients={clients}
            setClients={setClients}
            onDone={() => { changeTab("bookings"); document.querySelector("[data-scroll-pane]")?.scrollTo({ top: 0, behavior: "smooth" }); }}
            walkerProfiles={walkerProfiles}
            allowHistorical={true}
          />
        )}

        {/* ── Payroll ── */}
        {tab === "payroll" && (() => {
          const { monday: payMon, sunday: paySun } = getWeekRangeForOffset(payrollWeekOffset);
          const weekKey = payMon.toISOString().slice(0, 10);
          // Stale cache warning
          const payrollWarning = payrollStale ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#fef3c7",
              border: "1.5px solid #f59e0b", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px" }}>
              <span style={{ fontSize: "20px" }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, color: "#92400e", fontSize: "14px" }}>Payroll data may be outdated</div>
                <div style={{ color: "#78350f", fontSize: "13px" }}>Could not reach the database. Showing cached data — do not process payroll until the connection is restored.</div>
              </div>
            </div>
          ) : null;
          const payrollError = payrollSaveError ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#fee2e2",
              border: "1.5px solid #ef4444", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px" }}>
              <span style={{ fontSize: "20px" }}>🚫</span>
              <div>
                <div style={{ fontWeight: 700, color: "#991b1b", fontSize: "14px" }}>Payroll not saved</div>
                <div style={{ color: "#7f1d1d", fontSize: "13px" }}>{payrollSaveError}</div>
              </div>
              <button onClick={() => setPayrollSaveError("")}
                style={{ marginLeft: "auto", background: "none", border: "none", color: "#991b1b",
                  cursor: "pointer", fontSize: "18px", lineHeight: 1 }}>✕</button>
            </div>
          ) : null;

          // All admin-completed walks in the selected week
          const weekCompleted = completedBookings.filter(b => {
            const d = new Date(b.scheduledDateTime || b.completedAt || b.bookedAt);
            return d >= payMon && d <= paySun;
          });

          // Build per-walker payroll entries
          const walkerPayrollMap = {};
          getAllWalkers(walkerProfiles).forEach(w => {
            walkerPayrollMap[w.name] = { walker: w, walks: [], total: 0, gratuity: 0 };
          });
          weekCompleted.forEach(b => {
            const name = b.form?.walker || "Unassigned";
            if (!walkerPayrollMap[name]) {
              walkerPayrollMap[name] = { walker: { name, id: null, avatar: "❓", color: "#9ca3af" }, walks: [], total: 0, gratuity: 0 };
            }
            const payout = getWalkerPayout(b);
            walkerPayrollMap[name].walks.push({ ...b, payout });
            walkerPayrollMap[name].total += payout;
          });

          // Add gratuity from paid invoices in this week for each walker's key clients
          Object.values(clients).forEach(c => {
            if (c.deleted) return;
            const walkerName = c.keyholder;
            if (!walkerName || !walkerPayrollMap[walkerName]) return;
            (c.invoices || []).forEach(inv => {
              if (inv.status !== "paid" || !inv.gratuity) return;
              const paidDate = new Date(inv.paidAt);
              if (paidDate >= payMon && paidDate <= paySun) {
                walkerPayrollMap[walkerName].gratuity += inv.gratuity;
              }
            });
          });

          const activeEntries = Object.values(walkerPayrollMap)
            .filter(e => e.walks.length > 0)
            .sort((a, b) => b.total - a.total);

          const grandTotal = activeEntries.reduce((s, e) => s + e.total, 0);
          const grandGratuity = activeEntries.reduce((s, e) => s + (e.gratuity || 0), 0);

          const weekLabel =
            payMon.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
            " \u2013 " +
            paySun.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

          const fmtDate = (iso) =>
            new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

          // Which walkers are already marked paid for this week?
          const paidThisWeek = new Set(
            completedPayrolls.filter(r => r.weekKey === weekKey).map(r => r.walkerName)
          );
          const pendingEntries = activeEntries.filter(e => !paidThisWeek.has(e.walker.name));
          const paidEntries    = activeEntries.filter(e =>  paidThisWeek.has(e.walker.name));

          const markPayrollComplete = async (walkerName) => {
            const entry = activeEntries.find(e => e.walker.name === walkerName);
            if (!entry) return;
            const w = entry.walker;
            const prof = walkerProfiles[w.id] || {};
            const record = {
              id: `${walkerName}-${weekKey}-${Date.now()}`,
              walkerName,
              walkerFullName: prof.preferredName || w.name,
              walkerAddress:  prof.address || addrToString(prof.addrObj) || "",
              walkerEmail:    prof.email || w.email || "",
              walkerPhone:    prof.phone || "",
              walkerAvatar:   w.avatar || "🐾",
              walkerColor:    w.color || "#C4541A",
              weekKey,
              weekLabel,
              weekStart: payMon.toISOString(),
              weekEnd:   paySun.toISOString(),
              total:     entry.total,
              walkCount: entry.walks.length,
              walks: entry.walks.map(b => ({
                key: b.key,
                pet: b.form?.pet || "",
                clientName: b.clientName || "",
                duration: b.slot?.duration || "",
                slotTime: b.slot?.time || "",
                scheduledDateTime: b.scheduledDateTime || b.bookedAt,
                payout: b.payout,
                service: b.service,
              })),
              paidAt: new Date().toISOString(),
            };
            const updated = [...completedPayrolls, record];
            setPayrollSaveError("");
            try {
              await saveCompletedPayrolls(updated);
              setCompletedPayrolls(updated);
              setPayrollStale(false);
              logAuditEvent({ adminId: admin.id, adminName: admin.name,
                action: "payroll_completed", entityType: "payroll",
                entityId: record.walkerId,
                details: { walkerName: record.walkerName, amount: record.totalPayout,
                  walkCount: record.walks?.length, weekLabel: record.weekLabel } });
              setConfirmPayrollWalker(null);
            } catch (err) {
              setPayrollSaveError(err.message || "Payroll could not be saved. Please try again.");
            }
          };

          const downloadCSV = (entriesToExport) => {
            const rows = [["Walker Name","Address","Walk Date","Time","Duration","Client","Pet","Payout ($)","Gratuity ($)"]];
            entriesToExport.forEach(({ walker: w, walks, gratuity: walkerGrat }) => {
              const prof = walkerProfiles[w.id] || {};
              const name = prof.preferredName || w.name;
              const address = prof.address || addrToString(prof.addrObj) || "No address on file";
              const sorted = [...walks].sort((a,b) => new Date(a.scheduledDateTime||a.bookedAt) - new Date(b.scheduledDateTime||b.bookedAt));
              rows.push([`--- ${name} ---`, address, "", "", "", "", "", "", ""]);
              sorted.forEach(b => {
                const dt = new Date(b.scheduledDateTime || b.bookedAt);
                rows.push([
                  name, address,
                  dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
                  b.slot?.time || dt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
                  b.slot?.duration || "", b.clientName || "", b.form?.pet || "",
                  (b.payout||0).toFixed(2), "",
                ]);
              });
              const walkerTotal = walks.reduce((s,b) => s + (b.payout||0), 0);
              rows.push(["", "", "", "", "", "", `Total walks for ${name}:`, walkerTotal.toFixed(2), ""]);
              if (walkerGrat > 0) rows.push(["", "", "", "", "", "", `Gratuity for ${name}:`, "", walkerGrat.toFixed(2)]);
              rows.push(["","","","","","","","",""]);
            });
            const grandTotal = entriesToExport.reduce((s,e) => s + e.walks.reduce((ws,b) => ws+(b.payout||0),0), 0);
            const grandGrat  = entriesToExport.reduce((s,e) => s + (e.gratuity||0), 0);
            rows.push(["","","","","","","TOTAL PAYROLL:", grandTotal.toFixed(2), ""]);
            if (grandGrat > 0) rows.push(["","","","","","","TOTAL GRATUITY:", "", grandGrat.toFixed(2)]);
            const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `payroll-week-of-${weekKey}.csv`; a.click();
            URL.revokeObjectURL(url);
          };

          const downloadXLS = (entriesToExport) => {
            const walkerColor = (hex) => hex || "#C4541A";
            const hexToRgb = (hex) => {
              const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
              return `rgb(${r},${g},${b})`;
            };
            const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
            const td = (val, style="") => `<td style="font-family:Arial,sans-serif;font-size:11px;padding:5px 10px;border:1px solid #e4e7ec;${style}">${esc(val)}</td>`;

            const colHeaders = ["Walk Date","Time","Duration","Client","Pet","Payout"];
            const totalPayroll = entriesToExport.reduce((s, e) => s + e.walks.reduce((ws, b) => ws + (b.payout||0), 0), 0);

            let body = "";

            entriesToExport.forEach(({ walker: w, walks }) => {
              const prof = walkerProfiles[w.id] || {};
              const name = prof.preferredName || w.name;
              const address = prof.address || addrToString(prof.addrObj) || "No address on file";
              const color = walkerColor(w.color);
              const walkerTotal = walks.reduce((s, b) => s + (b.payout || 0), 0);
              const sorted = [...walks].sort((a, b) =>
                new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt)
              );

              // Walker name header row
              body += `<tr>
                <td colspan="6" style="background-color:${color};color:#fff;font-family:Arial,sans-serif;
                  font-size:15px;font-weight:bold;padding:8px 12px;border:1px solid ${color};">
                  ${esc(name)}
                </td>
              </tr>`;

              // Address row
              body += `<tr>
                <td colspan="6" style="background-color:#f0f0f0;color:#555;font-family:Arial,sans-serif;
                  font-size:10px;padding:4px 12px;border:1px solid #ddd;font-style:italic;">
                  ${esc(address)}
                </td>
              </tr>`;

              // Column header row
              body += `<tr>${colHeaders.map(h =>
                `<td style="background-color:#FDF0E4;color:#7A4E28;font-family:Arial,sans-serif;
                  font-size:10px;font-weight:bold;padding:5px 10px;border:1px solid #E8CEAA;
                  text-transform:uppercase;letter-spacing:0.5px;">${h}</td>`
              ).join("")}</tr>`;

              // Walk rows
              sorted.forEach((b, idx) => {
                const dt = new Date(b.scheduledDateTime || b.bookedAt);
                const bg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
                body += `<tr>
                  ${td(dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}), `background:${bg};`)}
                  ${td(b.slot?.time || dt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}), `background:${bg};`)}
                  ${td(b.slot?.duration || "", `background:${bg};`)}
                  ${td(b.clientName || "", `background:${bg};`)}
                  ${td(b.form?.pet || "", `background:${bg};`)}
                  ${td(fmt((b.payout||0), true), `background:${bg};text-align:right;font-weight:600;`)}
                </tr>`;
              });

              // Walker subtotal row
              body += `<tr>
                <td colspan="5" style="background-color:${color}18;font-family:Arial,sans-serif;
                  font-size:11px;font-weight:bold;padding:6px 10px;border:1px solid ${color}44;
                  text-align:right;color:#374151;">Total for ${esc(name)}</td>
                <td style="background-color:${color}18;font-family:Arial,sans-serif;font-size:12px;
                  font-weight:bold;padding:6px 10px;border:1px solid ${color}44;
                  text-align:right;color:${color};">${fmt(walkerTotal, true)}</td>
              </tr>`;

              // Spacer row
              body += `<tr><td colspan="6" style="padding:6px;border:none;background:#fff;"></td></tr>`;
            });

            // Grand total row
            body += `<tr>
              <td colspan="5" style="background-color:#4D2E10;color:#fff;font-family:Arial,sans-serif;
                font-size:13px;font-weight:bold;padding:8px 12px;border:1px solid #4D2E10;
                text-align:right;">TOTAL PAYROLL</td>
              <td style="background-color:#4D2E10;color:#4ade80;font-family:Arial,sans-serif;
                font-size:14px;font-weight:bold;padding:8px 12px;border:1px solid #4D2E10;
                text-align:right;">${fmt(totalPayroll, true)}</td>
            </tr>`;

            const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:x="urn:schemas-microsoft-com:office:excel"
              xmlns="http://www.w3.org/TR/REC-html40">
              <head><meta charset="utf-8">
                <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
                <x:ExcelWorksheet><x:Name>Payroll</x:Name>
                <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
                </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
              </head>
              <body><table>${body}</table></body></html>`;

            const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href     = url;
            a.download = `payroll-week-of-${weekKey}.xls`;
            a.click();
            URL.revokeObjectURL(url);
          };

          // ── History: completed payroll records across all weeks ──────────────
          const historyByWeek = {};
          completedPayrolls.forEach(r => {
            if (!historyByWeek[r.weekKey]) historyByWeek[r.weekKey] = [];
            historyByWeek[r.weekKey].push(r);
          });
          const historySorted = Object.entries(historyByWeek)
            .sort(([a], [b]) => b.localeCompare(a)); // newest first

          // Helper: get gratuity paid to a walker in a given week from invoices
          const getWalkerWeekGratuity = (walkerName, weekKey) => {
            const weekMon = new Date(weekKey + "T00:00:00");
            const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6); weekSun.setHours(23,59,59,999);
            return Object.values(clients).filter(c => c.keyholder === walkerName)
              .flatMap(c => (c.invoices || []).filter(inv =>
                inv.status === "paid" && inv.gratuity > 0 &&
                inv.paidAt && new Date(inv.paidAt) >= weekMon && new Date(inv.paidAt) <= weekSun
              ))
              .reduce((s, inv) => s + (inv.gratuity || 0), 0);
          };

          return (
            <div className="fade-up">

              {/* ── Header ── */}
              <div style={{ display: "flex", alignItems: "flex-start",
                justifyContent: "space-between", gap: "12px", marginBottom: "6px" }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Payroll</div>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#6b7280", lineHeight: "1.5" }}>{weekLabel}</p>
                </div>
                {activeEntries.length > 0 && (
                  <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                    <button onClick={() => downloadCSV(activeEntries)} style={{
                      padding: "9px 14px", borderRadius: "10px",
                      border: "1.5px solid #059669", background: "#fff",
                      color: "#059669", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "16px", fontWeight: 600, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "5px",
                    }}>⬇ CSV</button>
                    <button onClick={() => downloadXLS(activeEntries)} style={{
                      padding: "9px 14px", borderRadius: "10px",
                      border: "1.5px solid #059669", background: "#FDF5EC",
                      color: "#059669", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "16px", fontWeight: 600, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "5px",
                    }}>⬇ Excel</button>
                  </div>
                )}
              </div>

              {payrollWarning}
              {payrollError}
              {/* ── Week navigator ── */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "24px" }}>
                <button onClick={() => setPayrollWeekOffset(o => o - 1)} style={{
                  padding: "8px 16px", borderRadius: "9px", border: "1.5px solid #e4e7ec",
                  background: "#fff", color: "#374151", cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 500,
                }}>← Prev</button>
                <div style={{ flex: 1, textAlign: "center", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", fontWeight: 600, color: "#111827" }}>
                  {payrollWeekOffset === 0 ? "This Week" : payrollWeekOffset === -1 ? "Last Week" : payrollWeekOffset === 1 ? "Next Week" : weekLabel}
                </div>
                <button onClick={() => setPayrollWeekOffset(o => o + 1)} style={{
                    padding: "8px 16px", borderRadius: "9px", border: "1.5px solid #e4e7ec",
                    background: "#fff", color: "#374151", cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 500,
                  }}>Next →</button>
              </div>

              {/* ── Summary banner ── */}
              {activeEntries.length > 0 && (
                <div style={{ background: "#4D2E10", borderRadius: "14px",
                  padding: "16px 22px", marginBottom: "20px",
                  display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#d97706", letterSpacing: "0.4px" }}>
                    {pendingEntries.length > 0
                      ? `${pendingEntries.length} of ${activeEntries.length} walker${activeEntries.length !== 1 ? "s" : ""} pending`
                      : `All ${activeEntries.length} walker${activeEntries.length !== 1 ? "s" : ""} paid ✓`}
                    &nbsp;·&nbsp;{weekCompleted.length} walk{weekCompleted.length !== 1 ? "s" : ""}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color: "#fff" }}>
                      ${grandTotal.toLocaleString()}
                    </div>
                    {grandGratuity > 0 && (
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                        fontWeight: 600, color: "#a8d5bf" }}>
                        + ${grandGratuity.toFixed(2)} gratuity
                      </div>
                    )}
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#a07040" }}>
                      total payroll this week
                    </div>
                  </div>
                </div>
              )}

              {/* ── Empty state ── */}
              {activeEntries.length === 0 && (
                <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                  borderRadius: "14px", padding: "48px 20px", textAlign: "center",
                  marginBottom: "32px" }}>
                  <div style={{ fontSize: "34px", marginBottom: "12px" }}>📭</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                    No completed walks this week
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>
                    Mark walks as completed in All Bookings to see them here.
                  </div>
                </div>
              )}

              {/* ── Pending walker cards ── */}
              {pendingEntries.map(({ walker: w, walks, total, gratuity }) => {
                const prof = walkerProfiles[w.id] || {};
                const fullName  = prof.preferredName || w.name;
                const address   = prof.address || addrToString(prof.addrObj) || "";
                const email     = prof.email || w.email || "";
                const phone     = prof.phone || "";
                const hasAddress = !!address.trim();
                const color     = w.color || "#C4541A";
                const isPending = confirmPayrollWalker === w.name;
                const isExpanded = expandedPayrollWalkers.has(w.name);
                const toggleExpand = () => setExpandedPayrollWalkers(prev => {
                  const next = new Set(prev);
                  next.has(w.name) ? next.delete(w.name) : next.add(w.name);
                  return next;
                });
                const sortedWalks = [...walks].sort((a, b) =>
                  new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt)
                );
                return (
                  <div key={w.id || w.name} style={{
                    background: "#fff", border: `1.5px solid ${color}22`,
                    borderRadius: "16px", marginBottom: "18px", overflow: "hidden",
                    boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
                  }}>
                    {/* Walker header — click to expand/collapse walks */}
                    <button onClick={toggleExpand} style={{
                      width: "100%", padding: "18px 20px",
                      borderBottom: isExpanded ? "1px solid #f3f4f6" : "none",
                      display: "flex", alignItems: "center", gap: "14px",
                      background: "none", border: "none", cursor: "pointer", textAlign: "left",
                    }}>
                      <div style={{ width: "50px", height: "50px", borderRadius: "50%",
                        background: color + "18", border: `2px solid ${color}44`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "22px", flexShrink: 0 }}>{w.avatar || "🐾"}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                          fontSize: "15px", color: "#111827", marginBottom: "3px" }}>{fullName}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#9ca3af" }}>
                          {sortedWalks.length} walk{sortedWalks.length !== 1 ? "s" : ""}
                          {hasAddress ? ` · 📍 ${address}` : " · ⚠️ No address on file"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, display: "flex",
                        alignItems: "center", gap: "10px" }}>
                        <div>
                          {gratuity > 0 ? (
                            <>
                              <div style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "13px", color: "#9ca3af", marginBottom: "2px" }}>
                                Walks ${total.toLocaleString()} + ${gratuity.toFixed(2)} tip
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "17px", fontWeight: 700, color: "#059669",
                                letterSpacing: "0.5px" }}>
                                ${(total + gratuity).toFixed(2)} total due
                              </div>
                            </>
                          ) : (
                            <div style={{ fontFamily: "'DM Sans', sans-serif",
                              fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color }}>
                              ${total.toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: "16px", color: "#9ca3af",
                          transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform 0.15s" }}>›</div>
                      </div>
                    </button>

                    {/* Walk rows — only shown when expanded */}
                    {isExpanded && (
                      <div className="fade-up">
                        {sortedWalks.map((b, i) => (
                          <div key={b.key || i} style={{
                            padding: "12px 20px",
                            borderBottom: i < sortedWalks.length - 1 ? "1px solid #f9fafb" : "none",
                            display: "flex", alignItems: "center", gap: "14px",
                          }}>
                            <div style={{ width: "36px", height: "36px", borderRadius: "9px",
                              background: "#f9fafb", border: "1px solid #f3f4f6",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "16px", flexShrink: 0 }}>
                              {b.service === "cat" ? "🐈" : "🐕"}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                fontSize: "15px", color: "#111827", marginBottom: "2px" }}>
                                {b.form?.pet || "Pet"}
                                <span style={{ fontWeight: 400, color: "#9ca3af", fontSize: "16px" }}>
                                  {" · "}{b.slot?.duration || ""}
                                </span>
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                                {fmtDate(b.scheduledDateTime || b.bookedAt)}
                                {b.slot?.time && ` at ${b.slot?.time}`}
                                {b.clientName && <span style={{ color: "#9ca3af" }}> · {b.clientName}</span>}
                              </div>
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                              fontSize: "16px", color: "#059669", flexShrink: 0 }}>
                              ${b.payout}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Footer: mailing note + Mark Payroll Complete */}
                    <div style={{ padding: "14px 20px", background: hasAddress ? "#f9fafb" : "#fffbeb",
                      borderTop: "1px solid #f3f4f6" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: hasAddress ? "#9ca3af" : "#b45309", marginBottom: gratuity > 0 ? "6px" : "12px" }}>
                        {hasAddress
                          ? `📬 Send ${gratuity > 0 ? `$${(total + gratuity).toFixed(2)}` : `$${total.toLocaleString()}`} to: ${address}`
                          : "📬 Ask this walker to add their mailing address in My Info before cutting a check."}
                      </div>
                      {gratuity > 0 && (
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                          color: "#059669", fontWeight: 500, marginBottom: "12px",
                          background: "#f0fdf4", border: "1px solid #a8d5bf",
                          borderRadius: "8px", padding: "7px 12px" }}>
                          Gratuity to pass along: ${gratuity.toFixed(2)} (from client — goes 100% to walker)
                        </div>
                      )}
                      {isPending ? (
                        <div className="fade-up">
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#374151", fontWeight: 500, marginBottom: "10px" }}>
                            Mark {fullName}'s payroll as complete for {weekLabel}?
                          </div>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button onClick={() => markPayrollComplete(w.name)} style={{
                              flex: 1, padding: "10px", borderRadius: "10px", border: "none",
                              background: "#059669", color: "#fff",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 600, cursor: "pointer",
                            }}>✓ Yes, Mark Paid</button>
                            <button onClick={() => setConfirmPayrollWalker(null)} style={{
                              padding: "10px 16px", borderRadius: "10px",
                              border: "1.5px solid #e4e7ec", background: "#fff",
                              color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                              fontSize: "15px", cursor: "pointer",
                            }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmPayrollWalker(w.name)} style={{
                          width: "100%", padding: "11px", borderRadius: "10px",
                          border: "1.5px solid #05966944", background: "#FDF5EC",
                          color: "#059669", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 600, cursor: "pointer",
                        }}>✓ Mark Payroll Complete</button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* ── Already-paid this week ── */}
              {paidEntries.length > 0 && (
                <div style={{ marginBottom: "32px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
                    color: "#9ca3af", marginBottom: "10px" }}>Paid This Week</div>
                  {paidEntries.map(({ walker: w, total }) => {
                    const color    = w.color || "#C4541A";
                    const prof     = walkerProfiles[w.id] || {};
                    const fullName = prof.preferredName || w.name;
                    return (
                      <div key={w.id || w.name} style={{
                        background: "#FDF5EC", border: "1.5px solid #EDD5A8",
                        borderRadius: "12px", padding: "14px 18px", marginBottom: "8px",
                        display: "flex", alignItems: "center", gap: "12px",
                      }}>
                        <div style={{ width: "38px", height: "38px", borderRadius: "50%",
                          background: color + "18", border: `2px solid ${color}44`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "18px", flexShrink: 0 }}>{w.avatar || "🐾"}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                            fontSize: "16px", color: "#111827" }}>{fullName}</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#059669" }}>✓ Payroll complete</div>
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color: "#059669" }}>
                          ${total.toLocaleString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Completed Payroll History ── */}
              {historySorted.length > 0 && (
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
                    color: "#9ca3af", marginBottom: "14px" }}>Completed Payroll History</div>
                  {historySorted.map(([wk, records]) => {
                    const wkLabel = records[0]?.weekLabel || wk;
                    const wkTotal = records.reduce((s, r) => s + r.total, 0);
                    const wkGratuity = records.reduce((s, r) => s + getWalkerWeekGratuity(r.walkerName, wk), 0);
                    return (
                      <div key={wk} style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                        borderRadius: "14px", marginBottom: "12px", overflow: "hidden" }}>
                        {/* Week header */}
                        <div style={{ padding: "14px 18px", borderBottom: "1px solid #f3f4f6",
                          display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                              fontSize: "15px", color: "#111827" }}>Week of {wkLabel}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#9ca3af", marginTop: "2px" }}>
                              {records.length} walker{records.length !== 1 ? "s" : ""} paid
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <button onClick={() => {
                              const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
                              const td = (val, style="") => `<td style="font-family:Arial,sans-serif;font-size:11px;padding:5px 10px;border:1px solid #e4e7ec;${style}">${esc(val)}</td>`;
                              const colHeaders = ["Walk Date","Time","Duration","Client","Pet","Payout","Gratuity"];
                              const totalPayroll = records.reduce((s,r) => s + r.total, 0);
                              const totalGrat    = records.reduce((s,r) => s + getWalkerWeekGratuity(r.walkerName, wk), 0);
                              let body = "";
                              records.forEach(r => {
                                const rGrat = getWalkerWeekGratuity(r.walkerName, wk);
                                const color = r.walkerColor || "#C4541A";
                                const sorted = [...r.walks].sort((a,b) => new Date(a.scheduledDateTime) - new Date(b.scheduledDateTime));
                                body += `<tr><td colspan="7" style="background-color:${color};color:#fff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;padding:8px 12px;border:1px solid ${color};">${esc(r.walkerFullName)}</td></tr>`;
                                body += `<tr><td colspan="7" style="background-color:#f0f0f0;color:#555;font-family:Arial,sans-serif;font-size:10px;padding:4px 12px;border:1px solid #ddd;font-style:italic;">${esc(r.walkerAddress)}</td></tr>`;
                                body += `<tr>${colHeaders.map(h => `<td style="background-color:#FDF0E4;color:#7A4E28;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;padding:5px 10px;border:1px solid #E8CEAA;text-transform:uppercase;letter-spacing:0.5px;">${h}</td>`).join("")}</tr>`;
                                sorted.forEach((w, idx) => {
                                  const dt = new Date(w.scheduledDateTime);
                                  const bg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
                                  body += `<tr>
                                    ${td(dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),`background:${bg};`)}
                                    ${td(w.slotTime || dt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),`background:${bg};`)}
                                    ${td(w.duration,`background:${bg};`)}
                                    ${td(w.clientName,`background:${bg};`)}
                                    ${td(w.pet,`background:${bg};`)}
                                    ${td(fmt((w.payout||0), true),`background:${bg};text-align:right;font-weight:600;`)}
                                    ${td("",`background:${bg};`)}
                                  </tr>`;
                                });
                                body += `<tr>
                                  <td colspan="5" style="background-color:${color}18;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;padding:6px 10px;border:1px solid ${color}44;text-align:right;color:#374151;">Total walks for ${esc(r.walkerFullName)}</td>
                                  <td style="background-color:${color}18;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;padding:6px 10px;border:1px solid ${color}44;text-align:right;color:${color};">${fmt(r.total, true)}</td>
                                  <td style="background-color:${color}18;border:1px solid ${color}44;"></td>
                                </tr>`;
                                if (rGrat > 0) {
                                  body += `<tr>
                                    <td colspan="5" style="background-color:#f0fdf4;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;padding:6px 10px;border:1px solid #a8d5bf;text-align:right;color:#374151;">Gratuity for ${esc(r.walkerFullName)}</td>
                                    <td style="background-color:#f0fdf4;border:1px solid #a8d5bf;"></td>
                                    <td style="background-color:#f0fdf4;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;padding:6px 10px;border:1px solid #a8d5bf;text-align:right;color:#059669;">${fmt(rGrat, true)}</td>
                                  </tr>`;
                                }
                                body += `<tr><td colspan="7" style="padding:6px;border:none;background:#fff;"></td></tr>`;
                              });
                              body += `<tr>
                                <td colspan="5" style="background-color:#4D2E10;color:#fff;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;padding:8px 12px;border:1px solid #4D2E10;text-align:right;">TOTAL PAYROLL</td>
                                <td style="background-color:#4D2E10;color:#4ade80;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:8px 12px;border:1px solid #4D2E10;text-align:right;">${fmt(totalPayroll, true)}</td>
                                <td style="background-color:#4D2E10;border:1px solid #4D2E10;"></td>
                              </tr>`;
                              if (totalGrat > 0) {
                                body += `<tr>
                                  <td colspan="5" style="background-color:#059669;color:#fff;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;padding:8px 12px;border:1px solid #059669;text-align:right;">TOTAL GRATUITY</td>
                                  <td style="background-color:#059669;border:1px solid #059669;"></td>
                                  <td style="background-color:#059669;color:#fff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:8px 12px;border:1px solid #059669;text-align:right;">${fmt(totalGrat, true)}</td>
                                </tr>`;
                              }
                              const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body><table>${body}</table></body></html>`;
                              const blob2 = new Blob([html],{type:"application/vnd.ms-excel;charset=utf-8"});
                              const url2  = URL.createObjectURL(blob2);
                              const a2    = document.createElement("a");
                              a2.href = url2; a2.download = `payroll-${wk}.xls`; a2.click();
                              URL.revokeObjectURL(url2);
                            }} style={{
                              padding: "6px 12px", borderRadius: "8px",
                              border: "1.5px solid #059669", background: "#FDF5EC",
                              color: "#059669", fontFamily: "'DM Sans', sans-serif",
                              fontSize: "15px", fontWeight: 600, cursor: "pointer",
                            }}>⬇ Excel</button>
                            <button onClick={() => {
                              const rows = [["Walker Name","Address","Walk Date","Time","Duration","Client","Pet","Payout ($)","Gratuity ($)"]];
                              records.forEach(r => {
                                const rGrat = getWalkerWeekGratuity(r.walkerName, wk);
                                rows.push([`--- ${r.walkerFullName} ---`, r.walkerAddress,"","","","","","",""]);
                                [...r.walks].sort((a,b)=>new Date(a.scheduledDateTime)-new Date(b.scheduledDateTime)).forEach(w => {
                                  const dt = new Date(w.scheduledDateTime);
                                  rows.push([r.walkerFullName, r.walkerAddress,
                                    dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
                                    w.slotTime||dt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
                                    w.duration, w.clientName, w.pet, (w.payout||0).toFixed(2), ""]);
                                });
                                rows.push(["","","","","","",`Total walks for ${r.walkerFullName}:`, r.total.toFixed(2), ""]);
                                if (rGrat > 0) rows.push(["","","","","","",`Gratuity for ${r.walkerFullName}:`, "", rGrat.toFixed(2)]);
                                rows.push(["","","","","","","","",""]);
                              });
                              const grandTotal = records.reduce((s,r)=>s+r.total,0);
                              const grandGrat  = records.reduce((s,r)=>s+getWalkerWeekGratuity(r.walkerName,wk),0);
                              rows.push(["","","","","","","TOTAL PAYROLL:", grandTotal.toFixed(2), ""]);
                              if (grandGrat > 0) rows.push(["","","","","","","TOTAL GRATUITY:", "", grandGrat.toFixed(2)]);
                              const csv3 = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
                              const b3 = new Blob([csv3],{type:"text/csv"});
                              const u3 = URL.createObjectURL(b3);
                              const a3 = document.createElement("a");
                              a3.href=u3; a3.download=`payroll-${wk}.csv`; a3.click();
                              URL.revokeObjectURL(u3);
                            }} style={{
                              padding: "6px 12px", borderRadius: "8px",
                              border: "1.5px solid #059669", background: "#fff",
                              color: "#059669", fontFamily: "'DM Sans', sans-serif",
                              fontSize: "15px", fontWeight: 600, cursor: "pointer",
                            }}>⬇ CSV</button>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color: "#059669" }}>
                                ${wkTotal.toLocaleString()}
                              </div>
                              {wkGratuity > 0 && (
                                <div style={{ fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "12px", fontWeight: 600, color: "#059669",
                                  marginTop: "2px" }}>
                                  +${wkGratuity.toFixed(2)} tips
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Per-walker rows */}
                        {records.map((r, i) => {
                          const rGrat = getWalkerWeekGratuity(r.walkerName, wk);
                          return (
                          <div key={r.id} style={{
                            padding: "11px 18px",
                            borderBottom: i < records.length - 1 ? "1px solid #f9fafb" : "none",
                            display: "flex", alignItems: "center", gap: "12px",
                          }}>
                            <div style={{ fontSize: "18px", flexShrink: 0 }}>{r.walkerAvatar}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                fontSize: "15px", color: "#111827" }}>{r.walkerFullName}</div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                color: "#9ca3af" }}>
                                {r.walkCount} walk{r.walkCount !== 1 ? "s" : ""}
                                {r.walkerAddress ? ` · ${r.walkerAddress}` : ""}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                                fontSize: "15px", color: "#059669" }}>
                                ${(r.total + rGrat).toFixed(2)}
                              </div>
                              {rGrat > 0 && (
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "#9ca3af" }}>
                                  walks ${r.total} + ${rGrat.toFixed(2)} tip
                                </div>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

            </div>
          );
        })()}
        {/* ── Team Chat ── */}
        {tab === "chat" && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "6px" }}>Team Chat</div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
              marginBottom: "16px" }}>Messages are shared with the entire walker team.</p>

            <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
              borderRadius: "16px", overflow: "hidden" }}>
              <div ref={chatContainerRef} style={{ padding: "16px 18px", height: "480px", overflowY: "auto",
                display: "flex", flexDirection: "column", gap: "14px" }}>
                {chatLoading && chatMessages.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                    Loading messages…
                  </div>
                ) : chatMessages.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: "8px" }}>
                    <span style={{ fontSize: "32px" }}>💬</span>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                      No messages yet.
                    </div>
                  </div>
                ) : (
                  <>
                    {chatMessages.map(msg => {
                      const isMine = msg.from === "Admin";
                      return (
                        <div key={msg.id} style={{ display: "flex", flexDirection: "column",
                          alignItems: isMine ? "flex-end" : "flex-start" }}>
                          {!isMine && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              color: "#9ca3af", marginBottom: "4px", fontWeight: 600 }}>{msg.from}</div>
                          )}
                          <div style={{
                            padding: "10px 14px",
                            borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                            background: isMine ? amber : "#f3f4f6",
                            color: isMine ? "#fff" : "#111827",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            maxWidth: "80%", lineHeight: "1.5",
                          }}>{msg.text}</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#d1d5db", marginTop: "3px" }}>{msg.time}</div>
                        </div>
                      );
                    })}
                    <div ref={chatBottomRef} />
                  </>
                )}
              </div>
              <div style={{ padding: "12px 16px", borderTop: "1px solid #f3f4f6",
                display: "flex", gap: "8px" }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendAdminChat()}
                  placeholder="Message the team…"
                  style={{ flex: 1, padding: "10px 14px", borderRadius: "10px",
                    border: "1.5px solid #e4e7ec", background: "#fff",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#111827", outline: "none" }}
                />
                <button onClick={sendAdminChat} style={{
                  padding: "10px 18px", borderRadius: "10px", border: "none",
                  background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>Send</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Invoices ── */}
        {tab === "invoices" && (
          <AdminInvoicesTab key={invoicesKey} clients={clients} setClients={setClients} completedPayrolls={completedPayrolls} admin={admin} />
        )}

        {/* ── Map ── */}
        {tab === "map" && (
          <AdminMapView
            clients={clients}
            walkerProfiles={walkerProfiles}
            geoCache={mapGeoCache}
            setGeoCache={setMapGeoCache}
          />
        )}

        {/* ── Admins ── */}
        {tab === "admins" && (
          <AdminAdminsTab
            admin={admin}
            adminList={adminList}
            setAdminList={setAdminList}
            clients={clients}
            setClients={setClients}
            walkerProfiles={walkerProfiles}
            setWalkerProfiles={setWalkerProfiles}
            onLogout={onLogout}
          />
        )}

        {/* ── My Info ── */}
        {tab === "myinfo" && (
          <AdminMyInfo
            admin={admin}
            setAdmin={setAdmin}
            adminList={adminList}
            setAdminList={setAdminList}
            onLogout={onLogout}
          />
        )}

        {/* ── Contact Submissions ── */}
        {tab === "contact" && (
          <AdminContactTab />
        )}

        {/* ── Audit Log ── */}
        {tab === "audit" && (
          <AdminAuditTab admin={admin} />
        )}

      </div>
      </div>{/* end scrollable content */}
    </div>
  );
}

export default AdminDashboard;
