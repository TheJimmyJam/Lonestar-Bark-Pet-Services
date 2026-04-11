// ─── Supabase Configuration & Storage Functions ──────────────────────────────
// !! PASTE YOUR VALUES BELOW — replace the placeholder strings !!
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mvkmxmhsudqwxrsiifms.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a214bWhzdWRxd3hyc2lpZm1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NTEyMDIsImV4cCI6MjA5MTAyNzIwMn0.dP6PunUbTuuNs3K4CFBVmP8hmV29MBFActwemoDysxk";
const edgeHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
};

// Supabase JS client — used only for client-facing Auth (email/password,
// Google OAuth, password reset). All other data access in this file still
// uses the raw REST helper `sbFetch` so existing flows are untouched.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "lsbc-auth-session",
  },
});

async function notifyAdmin(type, data) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-admin`, {
      method: "POST",
      headers: edgeHeaders,
      body: JSON.stringify({ type, data }),
    });
    const body = await res.json();
    console.log(`[notifyAdmin] ${type} → ${res.status}`, body);
  } catch (e) {
    console.error("[notifyAdmin] failed:", e);
  }
}

async function sbFetch(path, options = {}, { retries = 1, retryDelay = 1200 } = {}) {
  const doFetch = () => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(options.headers || {}),
    },
  });

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch();
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Supabase error: ${err}`);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }
  }
  throw lastErr;
}

// ─── Supabase Storage Functions ───────────────────────────────────────────────

async function loadClients() {
  try {
    const rows = await sbFetch("clients?select=pin,email,data,user_id");
    if (!rows || rows.length === 0) return {};
    const result = {};
    rows.forEach(row => {
      try {
        const parsed = JSON.parse(row.data);
        // Preserve user_id on the client object so saveClients can round-trip it
        result[row.pin] = { ...parsed, pin: row.pin, user_id: row.user_id || parsed.user_id || null };
      } catch {}
    });
    return result;
  } catch (e) {
    console.error("loadClients failed:", e);
    return {};
  }
}

async function saveClients(clients) {
  try {
    const rows = Object.entries(clients).map(([pin, clientData]) => {
      // invoices now live in their own table — strip from the blob to avoid duplication
      const { invoices: _inv, ...rest } = clientData;
      const row = { pin, email: clientData.email || "", data: JSON.stringify(rest) };
      // Preserve Supabase Auth linkage if the client has one
      if (clientData.user_id) row.user_id = clientData.user_id;
      return row;
    });
    if (rows.length === 0) return;
    // Send all rows at once as an array upsert
    await sbFetch("clients?on_conflict=pin", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch (e) {
    console.error("saveClients failed:", e);
    throw new Error("Your booking could not be saved — database unavailable. Please try again.");
  }
}

async function loadWalkerProfiles() {
  try {
    const rows = await sbFetch("walkers?select=walker_id,email,data");
    if (!rows || rows.length === 0) return {};
    const result = {};
    rows.forEach(row => {
      try {
        const parsed = JSON.parse(row.data);
        result[row.walker_id] = parsed;
      } catch {}
    });
    return Object.keys(result).length > 0 ? result : {};
  } catch (e) {
    console.error("loadWalkerProfiles failed:", e);
    return {};
  }
}

async function saveWalkerProfiles(profiles) {
  try {
    const rows = Object.entries(profiles).map(([id, profileData]) => ({
      walker_id: parseInt(id),
      email: profileData.email || "",
      data: JSON.stringify(profileData),
    }));
    if (rows.length === 0) return;
    await sbFetch("walkers?on_conflict=walker_id", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch (e) {
    console.error("saveWalkerProfiles failed:", e);
  }
}

// ─── Invoice DB Functions ─────────────────────────────────────────────────────

async function loadInvoicesFromDB() {
  try {
    const rows = await sbFetch("invoices?select=*&order=created_at.desc");
    return (rows || []).map(r => ({
      id: r.id,
      type: r.type,
      weekLabel: r.week_label,
      items: typeof r.items === "string" ? JSON.parse(r.items) : (r.items || []),
      subtotal: r.subtotal,
      total: r.total,
      gratuity: r.gratuity || 0,
      notes: r.notes || "",
      status: r.status,
      createdAt: r.created_at,
      sentAt: r.sent_at,
      paidAt: r.paid_at,
      dueDate: r.due_date,
      autoGenerated: r.auto_generated,
      _clientId: r.client_id,
    }));
  } catch (e) {
    console.error("loadInvoicesFromDB failed:", e);
    return [];
  }
}

async function saveInvoiceToDB(invoice, clientId, clientName = "", clientEmail = "") {
  try {
    await sbFetch("invoices?on_conflict=id", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: invoice.id,
        client_id: clientId,
        client_name: clientName,
        client_email: clientEmail,
        status: invoice.status || "sent",
        type: invoice.type || "walk",
        week_label: invoice.weekLabel || null,
        items: invoice.items || [],
        subtotal: invoice.subtotal || 0,
        total: invoice.total || 0,
        notes: invoice.notes || "",
        due_date: invoice.dueDate || null,
        created_at: invoice.createdAt || new Date().toISOString(),
        sent_at: invoice.sentAt || null,
        paid_at: invoice.paidAt || null,
        auto_generated: invoice.autoGenerated || false,
      }),
    });
    console.log(`[saveInvoiceToDB] saved ${invoice.id} for client ${clientId}`);
  } catch (e) {
    console.error("[saveInvoiceToDB] FAILED — invoice NOT saved:", invoice.id, "clientId:", clientId, e);
  }
}

async function updateInvoiceInDB(invoiceId, updates) {
  try {
    // Map JS camelCase fields to DB snake_case
    const mapped = {};
    if (updates.status   !== undefined) mapped.status    = updates.status;
    if (updates.paidAt   !== undefined) mapped.paid_at   = updates.paidAt;
    if (updates.sentAt   !== undefined) mapped.sent_at   = updates.sentAt;
    if (updates.notes    !== undefined) mapped.notes     = updates.notes;
    if (updates.dueDate  !== undefined) mapped.due_date  = updates.dueDate;
    if (updates.gratuity !== undefined) mapped.gratuity  = updates.gratuity;
    await sbFetch(`invoices?id=eq.${encodeURIComponent(invoiceId)}`, {
      method: "PATCH",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify(mapped),
    });
  } catch (e) {
    console.error("updateInvoiceInDB failed:", e);
  }
}

async function deleteInvoiceFromDB(invoiceId) {
  try {
    await sbFetch(`invoices?id=eq.${encodeURIComponent(invoiceId)}`, {
      method: "DELETE",
    });
  } catch (e) {
    console.error("deleteInvoiceFromDB failed:", e);
  }
}

// Merge invoices loaded from the DB into the clients map (keyed by client pin/id)
function mergeInvoicesIntoClients(clients, invoiceRows) {
  // Start clean — invoices come from DB, not the blob
  const merged = {};
  Object.entries(clients).forEach(([id, c]) => {
    merged[id] = { ...c, invoices: [] };
  });
  invoiceRows.forEach(inv => {
    const clientId = inv._clientId;
    if (!merged[clientId]) return;
    const { _clientId, ...invData } = inv;
    merged[clientId].invoices.push(invData);
  });
  return merged;
}

async function loadTrades() {
  try {
    const rows = await sbFetch("trades?select=data&order=id.asc");
    if (!rows || rows.length === 0) return [];
    // trades table stores one row with all trades as JSON array
    return JSON.parse(rows[0].data);
  } catch (e) {
    console.error("loadTrades failed:", e);
    return [];
  }
}

async function saveTrades(trades) {
  try {
    // Delete existing and re-insert as single row
    await sbFetch("trades?id=gt.0", { method: "DELETE", headers: { "Prefer": "" } });
    if (trades.length > 0) {
      await sbFetch("trades", {
        method: "POST",
        body: JSON.stringify({ data: JSON.stringify(trades) }),
      });
    }
  } catch (e) {
    console.error("saveTrades failed:", e);
  }
}


// ─── Chat Persistence ─────────────────────────────────────────────────────────
function formatChatTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs  = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1)  return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs  < 24) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffDays < 7)  return d.toLocaleDateString("en-US", { weekday: "short" }) + " " +
                            d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
         d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

async function loadChatMessages() {
  try {
    const rows = await sbFetch("messages?select=id,from_name,text,sent_at&order=sent_at.asc&limit=200");
    return (rows || [])
      .filter(r => !r.from_name?.startsWith("dm:"))
      .map(r => ({
        id: r.id,
        from: r.from_name,
        text: r.text,
        sentAt: r.sent_at,
        time: formatChatTime(r.sent_at),
      }));
  } catch (e) {
    console.error("loadChatMessages failed:", e);
    return [];
  }
}

async function loadDirectMessages(nameA, nameB) {
  try {
    const enc = encodeURIComponent;
    const keyAB = enc(`dm:${nameA}→${nameB}`);
    const keyBA = enc(`dm:${nameB}→${nameA}`);
    const rows = await sbFetch(
      `messages?or=(from_name.eq.${keyAB},from_name.eq.${keyBA})&order=sent_at.asc&limit=200`
    );
    return (rows || []).map(r => ({
      id: r.id,
      from: r.from_name.replace(/^dm:/, "").split("→")[0],
      text: r.text,
      sentAt: r.sent_at,
      time: formatChatTime(r.sent_at),
    }));
  } catch (e) {
    console.error("loadDirectMessages failed:", e);
    return [];
  }
}

async function saveDirectMessage(fromName, toName, text) {
  try {
    await sbFetch("messages", {
      method: "POST",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify({ from_name: `dm:${fromName}→${toName}`, text, sent_at: new Date().toISOString() }),
    });
  } catch (e) { console.error("saveDirectMessage failed:", e); }
}

async function saveChatMessage(fromName, text) {
  try {
    await sbFetch("messages", {
      method: "POST",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify({ from_name: fromName, text, sent_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error("saveChatMessage failed:", e);
  }
}

// ─── Client ↔ Walker Direct Messages ─────────────────────────────────────────
async function loadClientMessages(clientEmail, walkerName) {
  try {
    const enc = encodeURIComponent;
    const rows = await sbFetch(
      `client_messages?client_email=eq.${enc(clientEmail)}&walker_name=eq.${enc(walkerName)}&select=id,from_name,text,sent_at&order=sent_at.asc&limit=200`
    );
    return (rows || []).map(r => ({
      id: r.id, from: r.from_name, text: r.text,
      sentAt: r.sent_at, time: formatChatTime(r.sent_at),
    }));
  } catch (e) { console.error("loadClientMessages failed:", e); return []; }
}

async function saveClientMessage(clientEmail, walkerName, fromName, text) {
  try {
    await sbFetch("client_messages", {
      method: "POST",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify({ client_email: clientEmail, walker_name: walkerName, from_name: fromName, text, sent_at: new Date().toISOString() }),
    });
  } catch (e) { console.error("saveClientMessage failed:", e); }
}

// ─── Payroll Persistence ──────────────────────────────────────────────────────
// Supabase is the sole source of truth for payroll records.
// localStorage is used only as a read-cache so the UI loads instantly —
// it is NEVER relied on as a save destination.
const PAYROLL_LS_CACHE_KEY = "dwi_completed_payrolls_cache_v2";

async function loadCompletedPayrolls() {
  // Always try Supabase first — it is the source of truth
  try {
    const rows = await sbFetch("payrolls?select=data&order=id.asc");
    if (rows && rows.length > 0) {
      const records = JSON.parse(rows[0].data);
      // Update read-cache so next load feels instant
      try { localStorage.setItem(PAYROLL_LS_CACHE_KEY, JSON.stringify(records)); } catch {}
      return records;
    }
    // Supabase responded but table is empty — that is the truth
    try { localStorage.removeItem(PAYROLL_LS_CACHE_KEY); } catch {}
    return [];
  } catch (e) {
    // Supabase unreachable — return stale cache with a warning flag so UI can show a banner
    console.error("loadCompletedPayrolls: Supabase unavailable, serving stale cache", e);
    try {
      const raw = localStorage.getItem(PAYROLL_LS_CACHE_KEY);
      const records = raw ? JSON.parse(raw) : [];
      return { records, stale: true };
    } catch {
      return { records: [], stale: true };
    }
  }
}

// saveCompletedPayrolls — throws if Supabase is unreachable so callers can
// show the user an error instead of silently losing financial data.
async function saveCompletedPayrolls(records) {
  try {
    await sbFetch("payrolls?id=gt.0", { method: "DELETE", headers: { "Prefer": "" } });
    if (records.length > 0) {
      await sbFetch("payrolls", {
        method: "POST",
        body: JSON.stringify({ data: JSON.stringify(records) }),
      });
    }
    // Update read-cache to match what is now in Supabase
    try { localStorage.setItem(PAYROLL_LS_CACHE_KEY, JSON.stringify(records)); } catch {}
  } catch (e) {
    console.error("saveCompletedPayrolls: Supabase write failed — payroll NOT saved", e);
    // Re-throw so the calling UI can surface an error to the admin
    throw new Error("Payroll could not be saved — database unavailable. Please try again.");
  }
}

// ─── Availability Helpers ─────────────────────────────────────────────────────
// Returns { "2025-04-07": ["8:00 AM","9:00 AM",...], ... } for a given walker
async function loadWalkerAvailability(walkerId) {
  try {
    const rows = await sbFetch(`availability?select=date,slots&walker_id=eq.${walkerId}`);
    const result = {};
    (rows || []).forEach(row => {
      try { result[row.date] = JSON.parse(row.slots); } catch {}
    });
    return result;
  } catch (e) {
    console.error("loadWalkerAvailability failed:", e);
    return {};
  }
}

// Save a single day's availability for a walker
async function saveWalkerAvailabilityDay(walkerId, date, slots) {
  try {
    await sbFetch("availability?on_conflict=walker_id,date", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ walker_id: walkerId, date, slots: JSON.stringify(slots) }),
    });
  } catch (e) {
    console.error("saveWalkerAvailabilityDay failed:", e);
  }
}

// Load availability for ALL walkers for a date range — used on client booking side
// Returns { walkerId: { "2025-04-07": ["8:00 AM",...], ... }, ... }
async function loadAllWalkersAvailability(startDate, endDate) {
  try {
    const rows = await sbFetch(
      `availability?select=walker_id,date,slots&date=gte.${startDate}&date=lte.${endDate}`
    );
    const result = {};
    (rows || []).forEach(row => {
      if (!result[row.walker_id]) result[row.walker_id] = {};
      try { result[row.walker_id][row.date] = JSON.parse(row.slots); } catch {}
    });
    return result;
  } catch (e) {
    console.error("loadAllWalkersAvailability failed:", e);
    return {};
  }
}


export {
  SUPABASE_URL, SUPABASE_ANON_KEY,
  notifyAdmin, sbFetch,
  uploadWalkPhoto,
  logAuditEvent, loadAuditLog,
  loadClients, saveClients,
  loadWalkerProfiles, saveWalkerProfiles,
  loadInvoicesFromDB, saveInvoiceToDB, updateInvoiceInDB, deleteInvoiceFromDB,
  mergeInvoicesIntoClients,
  loadTrades, saveTrades,
  formatChatTime, loadChatMessages, saveChatMessage,
  loadDirectMessages, saveDirectMessage,
  loadClientMessages, saveClientMessage,
  loadCompletedPayrolls, saveCompletedPayrolls,
  loadWalkerAvailability, saveWalkerAvailabilityDay, loadAllWalkersAvailability,
  DEFAULT_ADMIN, loadAdminList, saveAdminList, removeAdminFromDB,
  loadContactSubmissions, saveContactSubmission, updateContactSubmission, deleteContactSubmission,
  sendInvoiceEmail, sendWelcomeEmail, sendBookingConfirmation, sendInvoicePaidEmail, sendWalkerBookingNotification, sendPinResetCode,
  createBookingCheckout, createRefund, sendWalkerCancellationNotification, sendClientCancellationNotification,
  // Supabase Auth (clients only)
  supabase,
  authSignUpWithEmail, authSignInWithEmail, authSignInWithGoogle,
  authSendPasswordReset, authUpdatePassword, authSignOut,
  authGetSession, authOnChange,
  loadClientByUserId, synthPinFromUserId,
};

// ─── Audit Log ───────────────────────────────────────────────────────────────
// Fire-and-forget — never throws, so it never blocks an admin action.
async function logAuditEvent({ adminId = "", adminName = "", action = "", entityType = "", entityId = "", details = {} } = {}) {
  try {
    await sbFetch("audit_log", {
      method: "POST",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify({
        admin_id:    adminId,
        admin_name:  adminName,
        action,
        entity_type: entityType,
        entity_id:   String(entityId),
        details,
        created_at:  new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn("[logAuditEvent] failed (non-fatal):", e);
  }
}

async function loadAuditLog({ limit = 200, entityType = null, adminId = null } = {}) {
  try {
    let path = `audit_log?select=*&order=created_at.desc&limit=${limit}`;
    if (entityType) path += `&entity_type=eq.${encodeURIComponent(entityType)}`;
    if (adminId)    path += `&admin_id=eq.${encodeURIComponent(adminId)}`;
    const rows = await sbFetch(path);
    return (rows || []).map(r => ({
      id:         r.id,
      adminId:    r.admin_id,
      adminName:  r.admin_name,
      action:     r.action,
      entityType: r.entity_type,
      entityId:   r.entity_id,
      details:    r.details || {},
      createdAt:  r.created_at,
    }));
  } catch (e) {
    console.error("loadAuditLog failed:", e);
    return [];
  }
}

// ─── Admin List DB Functions ──────────────────────────────────────────────────
const DEFAULT_ADMIN = {
  id: "admin-1",
  name: "Admin",
  email: "admin@lonestarbark.com",
  pin: "000000",
  status: "active",
  isMaster: true,
  invitedBy: null,
  createdAt: new Date(0).toISOString(),
};

async function loadAdminList() {
  try {
    const rows = await sbFetch("admins?select=*&order=created_at.asc");
    if (rows && rows.length > 0) {
      return rows.map(r => ({
        id: r.id,
        name: r.name || "",
        email: r.email,
        pin: r.pin || "",
        status: r.status || "active",
        isMaster: r.is_master || false,
        invitedBy: r.invited_by || null,
        createdAt: r.created_at || new Date().toISOString(),
      }));
    }
    await saveAdminList([DEFAULT_ADMIN]);
    return [DEFAULT_ADMIN];
  } catch (e) {
    console.error("loadAdminList failed:", e);
    return [DEFAULT_ADMIN];
  }
}

async function saveAdminList(list) {
  try {
    const rows = list.map(a => ({
      id: a.id,
      name: a.name || "",
      email: a.email,
      pin: a.pin || "",
      status: a.status || "active",
      is_master: a.isMaster || false,
      invited_by: a.invitedBy || null,
      created_at: a.createdAt || new Date().toISOString(),
    }));
    await sbFetch("admins?on_conflict=id", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch (e) {
    console.error("saveAdminList failed:", e);
  }
}

async function removeAdminFromDB(id) {
  try {
    await sbFetch(`admins?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Prefer": "" },
    });
  } catch (e) {
    console.error("removeAdminFromDB failed:", e);
  }
}

// ─── Contact Submissions DB Functions ────────────────────────────────────────
async function loadContactSubmissions() {
  try {
    const rows = await sbFetch("contact_submissions?select=*&order=created_at.desc");
    return (rows || []).map(r => ({
      id: r.id,
      name: r.name || "",
      email: r.email || "",
      phone: r.phone || "",
      subject: r.subject || "",
      message: r.message || "",
      contactPref: r.contact_pref || "email",
      status: r.status || "new",
      adminNotes: r.admin_notes || "",
      source: r.source || "landing",
      createdAt: r.created_at,
    }));
  } catch (e) {
    console.error("loadContactSubmissions failed:", e);
    return [];
  }
}

async function saveContactSubmission(sub) {
  try {
    const row = {
      name: sub.name || "",
      email: sub.email || "",
      phone: sub.phone || "",
      subject: sub.subject || "",
      message: sub.message || "",
      contact_pref: sub.contactPref || "email",
      status: "new",
      source: sub.source || "landing",
      admin_notes: "",
      created_at: new Date().toISOString(),
    };
    const result = await sbFetch("contact_submissions", {
      method: "POST",
      body: JSON.stringify(row),
    });
    return result;
  } catch (e) {
    console.error("saveContactSubmission failed:", e);
    return null;
  }
}

async function updateContactSubmission(id, updates) {
  try {
    const row = {};
    if (updates.status !== undefined) row.status = updates.status;
    if (updates.adminNotes !== undefined) row.admin_notes = updates.adminNotes;
    await sbFetch(`contact_submissions?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
  } catch (e) {
    console.error("updateContactSubmission failed:", e);
  }
}

async function deleteContactSubmission(id) {
  try {
    await sbFetch(`contact_submissions?id=eq.${id}`, {
      method: "DELETE",
      headers: { "Prefer": "" },
    });
  } catch (e) {
    console.error("deleteContactSubmission failed:", e);
  }
}

// ─── Walk Photo Upload (Supabase Storage) ────────────────────────────────────

async function uploadWalkPhoto(bookingKey, file) {
  // Sanitise the booking key so it's safe as a storage path segment
  const safeKey = bookingKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext  = file.name.split(".").pop() || "jpg";
  const path = `${safeKey}/${Date.now()}.${ext}`;

  const { data, error } = await supabase.storage
    .from("walk-photos")
    .upload(path, file, { cacheControl: "3600", upsert: false });

  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from("walk-photos")
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

// ─── Email Notifications (via Resend) ────────────────────────────────────────

async function sendInvoiceEmail(invoice, clientName, clientEmail, walkPhotos = []) {
  if (!clientEmail) {
    console.warn("[sendInvoiceEmail] No email for client, skipping.");
    return;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-invoice-email`, {
      method: "POST",
      headers: edgeHeaders,
      body: JSON.stringify({ clientName, clientEmail, invoice, walkPhotos }),
    });
    const body = await res.json();
    console.log(`[sendInvoiceEmail] ${clientEmail} → ${res.status}`, body);
  } catch (e) {
    console.error("[sendInvoiceEmail] failed:", e);
  }
}

async function sendWelcomeEmail({ clientName, clientEmail, meetDate, meetSlot, meetWalker }) {
  if (!clientEmail) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-welcome-email`, {
      method: "POST",
      headers: edgeHeaders,
      body: JSON.stringify({ clientName, clientEmail, meetDate, meetSlot, meetWalker }),
    });
    const body = await res.json();
    console.log(`[sendWelcomeEmail] ${clientEmail} → ${res.status}`, body);
  } catch (e) {
    console.error("[sendWelcomeEmail] failed:", e);
  }
}

async function sendBookingConfirmation({ clientName, clientEmail, service, date, day, time, duration, walker, price, pet }) {
  if (!clientEmail) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`, {
      method: "POST",
      headers: edgeHeaders,
      body: JSON.stringify({ clientName, clientEmail, service, date, day, time, duration, walker, price, pet }),
    });
    const body = await res.json();
    console.log(`[sendBookingConfirmation] ${clientEmail} → ${res.status}`, body);
  } catch (e) {
    console.error("[sendBookingConfirmation] failed:", e);
  }
}

async function sendWalkerCancellationNotification({ walkerName, walkerEmail, clientName, pet, service, date, day, time, duration }) {
  if (!walkerEmail) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-walker-cancellation-notification`, {
      method: "POST",
      headers: edgeHeaders,
      body: JSON.stringify({ walkerName, walkerEmail, clientName, pet, service, date, day, time, duration }),
    });
    const body = await res.json();
    console.log(`[sendWalkerCancellationNotification] ${walkerEmail} → ${res.status}`, body);
  } catch (e) {
    console.error("[sendWalkerCancellationNotification] failed:", e);
  }
}

async function sendClientCancellationNotification({ clientName, clientEmail, pet, service, date, day, time, duration, walker, refundAmount, refundPercent, isStripeRefund, refundId, receiptUrl, bookingPrice }) {
  if (!clientEmail) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-client-cancellation-notification`, {
      method: "POST",
      headers: edgeHeaders,
      body: JSON.stringify({ clientName, clientEmail, pet, service, date, day, time, duration, walker, refundAmount, refundPercent, isStripeRefund, refundId, receiptUrl, bookingPrice }),
    });
    const body = await res.json();
    console.log(`[sendClientCancellationNotification] ${clientEmail} → ${res.status}`, body);
  } catch (e) {
    console.error("[sendClientCancellationNotification] failed:", e);
  }
}

async function createBookingCheckout({ clientId, clientName, clientEmail, bookingKey, service, date, day, time, duration, walker, pet, amount }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-booking-checkout`, {
    method: "POST",
    headers: edgeHeaders,
    body: JSON.stringify({ clientId, clientName, clientEmail, bookingKey, service, date, day, time, duration, walker, pet, amount }),
  });
  const data = await res.json();
  console.log("[createBookingCheckout] response:", res.status, data);
  if (!res.ok || !data.url) throw new Error(data.error || "Could not create checkout session");
  return data; // { url, sessionId }
}

async function createRefund({ stripeSessionId, reason = "requested_by_customer", amount }) {
  // amount: optional dollar value for partial refund (e.g. 12.50); omit for full refund
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-refund`, {
    method: "POST",
    headers: edgeHeaders,
    body: JSON.stringify({ stripeSessionId, reason, ...(amount !== undefined ? { amount } : {}) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Refund failed");
  return data; // { refundId, status, amount }
}

async function sendPinResetCode({ name, email, code }) {
  if (!email) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-pin-reset-code`, {
      method: "POST",
      headers: edgeHeaders,
      body: JSON.stringify({ name, email, code }),
    });
    const body = await res.json();
    console.log(`[sendPinResetCode] ${email} → ${res.status}`, body);
  } catch (e) {
    console.error("[sendPinResetCode] failed:", e);
  }
}

async function sendWalkerBookingNotification({ walkerName, walkerEmail, clientName, pet, service, date, day, time, duration, price }) {
  if (!walkerEmail) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-walker-booking-notification`, {
      method: "POST",
      headers: edgeHeaders,
      body: JSON.stringify({ walkerName, walkerEmail, clientName, pet, service, date, day, time, duration, price }),
    });
    const body = await res.json();
    console.log(`[sendWalkerBookingNotification] ${walkerEmail} → ${res.status}`, body);
  } catch (e) {
    console.error("[sendWalkerBookingNotification] failed:", e);
  }
}

async function sendInvoicePaidEmail({ clientName, clientEmail, amount, invoiceId, paidAt }) {
  if (!clientEmail) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-invoice-paid`, {
      method: "POST",
      headers: edgeHeaders,
      body: JSON.stringify({ clientName, clientEmail, amount, invoiceId, paidAt }),
    });
    const body = await res.json();
    console.log(`[sendInvoicePaidEmail] ${clientEmail} → ${res.status}`, body);
  } catch (e) {
    console.error("[sendInvoicePaidEmail] failed:", e);
  }
}

// ─── Supabase Auth (clients only) ────────────────────────────────────────────
// Staff (admin, walker) still use PIN-based auth. These helpers are ONLY
// wired into the client portal auth flow.

// Sign up with email + password. Supabase will send a confirmation email
// using the template configured in the dashboard. `emailRedirectTo` is where
// the user lands after clicking the confirmation link.
async function authSignUpWithEmail({ email, password }) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/?auth=verified`,
    },
  });
  return { data, error };
}

async function authSignInWithEmail({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  return { data, error };
}

async function authSignInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/?auth=oauth`,
    },
  });
  return { data, error };
}

async function authSendPasswordReset(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: `${window.location.origin}/?auth=reset` }
  );
  return { data, error };
}

async function authUpdatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  return { data, error };
}

async function authSignOut() {
  try { await supabase.auth.signOut(); } catch (e) { console.error("[authSignOut]", e); }
}

async function authGetSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

function authOnChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return data?.subscription;
}

// Look up a client row by Supabase Auth user_id. Returns the parsed client
// object with its PIN attached, or null if not found.
async function loadClientByUserId(userId) {
  if (!userId) return null;
  try {
    const rows = await sbFetch(`clients?user_id=eq.${encodeURIComponent(userId)}&select=pin,email,data,user_id`);
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    try {
      const parsed = JSON.parse(row.data);
      return { ...parsed, pin: row.pin, user_id: row.user_id };
    } catch {
      return null;
    }
  } catch (e) {
    console.error("[loadClientByUserId] failed:", e);
    return null;
  }
}

// Generate a synthetic PIN for Supabase-Auth clients. The clients map is
// keyed by PIN throughout the app, so we need a stable unique value.
function synthPinFromUserId(userId) {
  return `au_${String(userId || "").replace(/-/g, "").slice(0, 10)}`;
}
