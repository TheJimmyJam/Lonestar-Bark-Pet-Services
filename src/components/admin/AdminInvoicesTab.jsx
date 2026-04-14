import { useState, useRef, useMemo } from "react";
import {
  saveClients, saveInvoiceToDB, updateInvoiceInDB, deleteInvoiceFromDB, notifyAdmin, sendInvoiceEmail, sendInvoicePaidEmail, logAuditEvent,
} from "../../supabase.js";
import {
  effectivePrice, getWalkerPayout, fmt, firstName,
  getBookingWeekKey, getCurrentWeekRange, getWeekRangeForOffset,
} from "../../helpers.js";
import { generateInvoiceId, getInvoiceDueDate, invoiceStatusMeta, getAllInvoices } from "../invoices/invoiceHelpers.js";
import StripePaymentModal from "../invoices/StripePaymentModal.jsx";
import Header from "../shared/Header.jsx";

// ─── Admin Invoices Tab ────────────────────────────────────────────────────────
function AdminInvoicesTab({ clients, setClients, completedPayrolls = [], admin = {} }) {
  const [view, setView] = useState("list"); // "list" | "create"
  const [filterStatus, setFilterStatus] = useState("all");

  const [expandedInv, setExpandedInv] = useState(null);
  const [expandedFinKpi, setExpandedFinKpi] = useState(null);

  // Create invoice state
  const [step, setStep] = useState(1); // 1=client, 2=type/items, 3=preview
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [invoiceType, setInvoiceType] = useState("walk"); // "walk" | "week" | "custom"
  const [selectedWalkKeys, setSelectedWalkKeys] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(null); // { monday, label }
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [customItems, setCustomItems] = useState([{ description: "", amount: "" }]);
  const [sending, setSending] = useState(false);
  const [sentConfirm, setSentConfirm] = useState(null);
  const [bulkState, setBulkState] = useState("idle"); // "idle"|"confirm"|"sending"|"done"
  const [bulkResult, setBulkResult] = useState(null); // { clientCount, walkCount }
  const [invoiceSearch, setInvoiceSearch] = useState("");

  const green = "#C4541A";
  const amber = "#b45309";

  // All Stripe-paid bookings across every client (paid at booking time via Stripe)
  const stripeReceiptsAll = Object.entries(clients).flatMap(([pin, c]) =>
    (c.bookings || [])
      .filter(b => b.stripeSessionId && b.paidAt)
      .map(b => ({ ...b, clientPin: pin, clientName: c.name || [c.firstName, c.lastName].filter(Boolean).join(" "), clientEmail: c.email }))
  ).sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
  const stripeTotal = stripeReceiptsAll.reduce((s, b) => s + (b.price || 0), 0);
  const { monday: stripeWeekMon } = getCurrentWeekRange();
  const stripeTotalWeek = stripeReceiptsAll
    .filter(b => b.paidAt && new Date(b.paidAt) >= stripeWeekMon)
    .reduce((s, b) => s + (b.price || 0), 0);
  const stripeCountWeek = stripeReceiptsAll.filter(b => b.paidAt && new Date(b.paidAt) >= stripeWeekMon).length;

  // Stripe-processed refunds — bookings that have a Stripe refund ID
  const stripeRefundRows = Object.entries(clients).flatMap(([pin, c]) =>
    (c.bookings || [])
      .filter(b => b.refundId && b.refundAmount > 0)
      .map(b => ({ ...b, clientPin: pin, clientName: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "—", clientEmail: c.email || "—" }))
  ).sort((a, b) => new Date(b.refundedAt || b.cancelledAt || 0) - new Date(a.refundedAt || a.cancelledAt || 0));
  const stripeRefundTotal = stripeRefundRows.reduce((s, b) => s + (b.refundAmount || 0), 0);

  const allInvoices = getAllInvoices(clients);
  const filtered = (filterStatus === "all" ? allInvoices : allInvoices.filter(inv => {
    const { effectiveStatus } = invoiceStatusMeta(inv.status, inv.dueDate);
    return effectiveStatus === filterStatus;
  })).filter(inv => {
    if (!invoiceSearch) return true;
    const q = invoiceSearch.toLowerCase();
    return (inv.clientName  || "").toLowerCase().includes(q)
      || (inv.clientEmail || "").toLowerCase().includes(q)
      || (inv.id          || "").toLowerCase().includes(q);
  });

  const activeClients = Object.values(clients).filter(c => !c.deleted);
  const selectedClient = selectedClientId ? clients[selectedClientId] : null;

  // Completed walks for selected client (can be invoiced)
  const clientCompletedWalks = selectedClient
    ? (selectedClient.bookings || []).filter(b => b.adminCompleted && !b.cancelled)
    : [];

  // Already-invoiced walk keys
  const invoicedKeys = new Set(
    (selectedClient?.invoices || [])
      .filter(inv => inv.status !== "draft")
      .flatMap(inv => inv.items.map(it => it.bookingKey))
  );

  const uninvoicedWalks = clientCompletedWalks.filter(b => !invoicedKeys.has(b.key));

  // Get weeks that have completed uninvoiced walks
  function getWalkWeekLabel(b) {
    const d = new Date(b.scheduledDateTime || b.bookedAt);
    const dow = d.getDay();
    const off = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(d); mon.setDate(d.getDate() + off);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const fmt = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { key: mon.toISOString().slice(0, 10), label: `${fmt(mon)} – ${fmt(sun)}`, monday: mon };
  }

  const weekGroups = {};
  uninvoicedWalks.forEach(b => {
    const wk = getWalkWeekLabel(b);
    if (!weekGroups[wk.key]) weekGroups[wk.key] = { ...wk, walks: [] };
    weekGroups[wk.key].walks.push(b);
  });
  const availableWeeks = Object.values(weekGroups).sort((a, b) => new Date(b.monday) - new Date(a.monday));

  // Build invoice preview items
  const previewItems = (() => {
    if (invoiceType === "walk") {
      return uninvoicedWalks
        .filter(b => selectedWalkKeys.includes(b.key))
        .map(b => ({
          bookingKey: b.key,
          description: `${b.form?.pet || "Pet"} · ${b.slot?.duration || ""} · ${b.day}, ${b.date}`,
          amount: effectivePrice(b),
        }));
    }
    if (invoiceType === "week" && selectedWeek) {
      return (weekGroups[selectedWeek]?.walks || []).map(b => ({
        bookingKey: b.key,
        description: `${b.form?.pet || "Pet"} · ${b.slot?.duration || ""} · ${b.day}, ${b.date}`,
        amount: effectivePrice(b),
      }));
    }
    if (invoiceType === "custom") {
      return customItems
        .filter(it => it.description.trim() && parseFloat(it.amount) > 0)
        .map(it => ({ description: it.description.trim(), amount: parseFloat(it.amount) }));
    }
    return [];
  })();
  const previewTotal = previewItems.reduce((s, it) => s + it.amount, 0);

  const resetCreate = () => {
    setStep(1); setSelectedClientId(null); setInvoiceType("walk");
    setSelectedWalkKeys([]); setSelectedWeek(null); setInvoiceNotes("");
    setCustomItems([{ description: "", amount: "" }]); setSentConfirm(null);
  };

  // ── Bulk invoice: find all uninvoiced completed walks across every client ──
  const allUninvoicedByClient = {};
  Object.entries(clients).filter(([, c]) => !c.deleted).forEach(([pin, c]) => {
    const invoicedKeys = new Set(
      (c.invoices || [])
        .filter(inv => inv.status !== "draft")
        .flatMap(inv => (inv.items || []).map(it => it.bookingKey))
    );
    const uninvoiced = (c.bookings || []).filter(
      b => b.adminCompleted && !b.cancelled && !invoicedKeys.has(b.key)
    );
    if (uninvoiced.length > 0) allUninvoicedByClient[pin] = { client: c, walks: uninvoiced };
  });
  const bulkClientCount = Object.keys(allUninvoicedByClient).length;
  const bulkWalkCount   = Object.values(allUninvoicedByClient).reduce((s, v) => s + v.walks.length, 0);

  const handleBulkSend = () => {
    setBulkState("sending");
    setTimeout(() => {
      const now  = new Date().toISOString();
      const upd  = { ...clients };
      Object.values(allUninvoicedByClient).forEach(({ client, walks }) => {
        const items = walks.map(b => ({
          bookingKey: b.key,
          description: `${b.form?.pet || "Pet"} · ${b.slot?.duration || ""} · ${b.day}, ${b.date}`,
          amount: effectivePrice(b),
        }));
        const total = items.reduce((s, it) => s + it.amount, 0);
        const inv = {
          id: generateInvoiceId(),
          type: "walk",
          weekLabel: null,
          items, subtotal: total, total,
          notes: "",
          status: "sent",
          createdAt: now, sentAt: now,
          dueDate: getInvoiceDueDate(now),
        };
        upd[pin] = { ...client, invoices: [...(client.invoices || []), inv] };
        saveInvoiceToDB(inv, pin, client.name || "", client.email || "");
        sendInvoiceEmail(inv, client.name || "", client.email || "");
      });
      setClients(upd);
      saveClients(upd);
      setBulkResult({ clientCount: bulkClientCount, walkCount: bulkWalkCount });
      setBulkState("done");
    }, 900);
  };

  const handleSendInvoice = () => {
    if (!selectedClient || previewItems.length === 0) return;
    setSending(true);
    setTimeout(() => {
      const now = new Date().toISOString();
      const newInv = {
        id: generateInvoiceId(),
        type: invoiceType,
        weekLabel: invoiceType === "week" ? weekGroups[selectedWeek]?.label : null,
        items: previewItems,
        subtotal: previewTotal,
        total: previewTotal,
        notes: invoiceNotes,
        status: "sent",
        createdAt: now,
        sentAt: now,
        dueDate: getInvoiceDueDate(now),
      };
      const updatedClient = {
        ...selectedClient,
        invoices: [...(selectedClient.invoices || []), newInv],
      };
      const updatedClients = { ...clients, [selectedClientId]: updatedClient };
      setClients(updatedClients);
      saveClients(updatedClients);
      // Persist to dedicated invoices table
      saveInvoiceToDB(newInv, selectedClientId, selectedClient.name || "", selectedClient.email || "");
      sendInvoiceEmail(newInv, selectedClient.name || "", selectedClient.email || "");
      logAuditEvent({ adminId: admin?.id, adminName: admin?.name,
        action: "invoice_sent", entityType: "invoice", entityId: newInv.id,
        details: { clientName: selectedClient.name, email: selectedClient.email,
          amount: newInv.total, invoiceId: newInv.id } });
      setSending(false);
      setSentConfirm(newInv);
    }, 900);
  };

  const handleMarkPaid = (clientId, invoiceId) => {
    const c = clients[clientId];
    if (!c) return;
    const paidAt = new Date().toISOString();
    const updatedClient = {
      ...c,
      invoices: (c.invoices || []).map(inv =>
        inv.id === invoiceId ? { ...inv, status: "paid", paidAt } : inv
      ),
    };
    const updatedClients = { ...clients, [clientId]: updatedClient };
    setClients(updatedClients);
    saveClients(updatedClients);
    // Update in dedicated invoices table
    updateInvoiceInDB(invoiceId, { status: "paid", paidAt });
    logAuditEvent({ adminId: admin?.id, adminName: admin?.name,
      action: "invoice_paid", entityType: "invoice", entityId: invoiceId,
      details: { clientName: c.name, invoiceId } });
    // Send invoice paid email
    const paid = (c.invoices || []).find(inv => inv.id === invoiceId);
    if (paid && c.email) {
      sendInvoicePaidEmail({
        clientName: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "there",
        clientEmail: c.email,
        amount: paid.total ?? paid.amount ?? 0,
        invoiceId,
        paidAt,
      });
    }
  };

  const handleVoidInvoice = (clientId, invoiceId) => {
    const c = clients[clientId];
    if (!c) return;
    const updatedClient = {
      ...c,
      invoices: (c.invoices || []).filter(inv => inv.id !== invoiceId),
    };
    const updatedClients = { ...clients, [clientId]: updatedClient };
    setClients(updatedClients);
    saveClients(updatedClients);
    // Delete from dedicated invoices table
    deleteInvoiceFromDB(invoiceId);
    if (expandedInv === invoiceId) setExpandedInv(null);
  };

  // ── KPI counts ──
  const pendingCount = allInvoices.filter(inv => {
    const { effectiveStatus } = invoiceStatusMeta(inv.status, inv.dueDate);
    return effectiveStatus === "sent" || effectiveStatus === "overdue";
  }).length;
  const overdueCount = allInvoices.filter(inv => invoiceStatusMeta(inv.status, inv.dueDate).effectiveStatus === "overdue").length;
  const paidTotal = allInvoices.filter(inv => inv.status === "paid").reduce((s, inv) => s + (inv.total || 0), 0);
  const pendingTotal = allInvoices.filter(inv => inv.status === "sent").reduce((s, inv) => s + (inv.total || 0), 0);
  // Gratuities owed = paid invoices with gratuity, MINUS any already disbursed via completed payroll
  const gratuityOwed = allInvoices.filter(inv => {
    if (inv.status !== "paid" || !inv.gratuity) return false;
    const clientEntry = Object.values(clients).find(c =>
      (c.invoices || []).some(i => i.id === inv.id)
    );
    const walkerName = clientEntry?.keyholder;
    if (!walkerName) return true;
    const paidDate = new Date(inv.paidAt);
    const dow = paidDate.getDay();
    const off = dow === 0 ? -6 : 1 - dow;
    const weekMon = new Date(paidDate);
    weekMon.setDate(paidDate.getDate() + off);
    weekMon.setHours(0, 0, 0, 0);
    const weekKey = weekMon.toISOString().slice(0, 10);
    const alreadyDisbursed = completedPayrolls.some(
      r => r.walkerName === walkerName && r.weekKey === weekKey
    );
    return !alreadyDisbursed;
  }).reduce((s, inv) => s + (inv.gratuity || 0), 0);
  // Gratuities paid lifetime = sum of all gratuities disbursed via completed payrolls
  const gratuitiesPaidLifetime = (() => {
    let total = 0;
    allInvoices.forEach(inv => {
      if (inv.status !== "paid" || !inv.gratuity) return;
      const clientEntry = Object.values(clients).find(c =>
        (c.invoices || []).some(i => i.id === inv.id)
      );
      const walkerName = clientEntry?.keyholder;
      if (!walkerName) return;
      const paidDate = new Date(inv.paidAt);
      const dow = paidDate.getDay();
      const off = dow === 0 ? -6 : 1 - dow;
      const weekMon = new Date(paidDate);
      weekMon.setDate(paidDate.getDate() + off);
      weekMon.setHours(0, 0, 0, 0);
      const weekKey = weekMon.toISOString().slice(0, 10);
      if (completedPayrolls.some(r => r.walkerName === walkerName && r.weekKey === weekKey)) {
        total += inv.gratuity;
      }
    });
    return total;
  })();

  // Refunds — scan all bookings for refundAmount > 0
  const { monday: refundWeekMon } = getCurrentWeekRange();
  const allRefundedBookings = Object.values(clients).flatMap(c =>
    (c.bookings || []).filter(b => b.refundAmount > 0)
  );
  const refundsLifetime = allRefundedBookings.reduce((s, b) => s + (b.refundAmount || 0), 0);
  const refundsThisWeek = allRefundedBookings
    .filter(b => b.refundedAt && new Date(b.refundedAt) >= refundWeekMon)
    .reduce((s, b) => s + (b.refundAmount || 0), 0);
  const refundCountLifetime = allRefundedBookings.length;
  const refundCountWeek = allRefundedBookings.filter(b => b.refundedAt && new Date(b.refundedAt) >= refundWeekMon).length;

  // ── Extended financial metrics ──
  const allCompletedBookings = Object.entries(clients).flatMap(([pin, c]) =>
    (c.bookings || []).filter(b => b.adminCompleted && !b.cancelled).map(b => ({
      ...b, clientId: pin,
      clientName: b.clientName || c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "",
    }))
  );
  const { monday: extWeekMon } = getCurrentWeekRange();
  const weekCompletedBookings = allCompletedBookings.filter(b =>
    new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) >= extWeekMon
  );
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const monthCompletedBookings = allCompletedBookings.filter(b =>
    new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) >= thirtyDaysAgo
  );
  const allRevenue = allCompletedBookings.reduce((s, b) => s + effectivePrice(b), 0)
    + stripeReceiptsAll.reduce((s, b) => s + effectivePrice(b), 0);
  const extWeekRevenue = weekCompletedBookings.reduce((s, b) => s + effectivePrice(b), 0)
    + stripeReceiptsAll.filter(b => new Date(b.paidAt) >= extWeekMon).reduce((s, b) => s + effectivePrice(b), 0);
  const monthRevenue = monthCompletedBookings.reduce((s, b) => s + effectivePrice(b), 0)
    + stripeReceiptsAll.filter(b => new Date(b.paidAt) >= thirtyDaysAgo).reduce((s, b) => s + effectivePrice(b), 0);
  const allWalkerPayout = allCompletedBookings.reduce((s, b) => s + getWalkerPayout(b), 0);
  const weekWalkerPayout = weekCompletedBookings.reduce((s, b) => s + getWalkerPayout(b), 0);
  const grossProfit = allRevenue - allWalkerPayout;
  const weekProfit = extWeekRevenue - weekWalkerPayout;
  const grossMarginPct = allRevenue > 0 ? (grossProfit / allRevenue * 100).toFixed(1) : "0.0";
  const laborRatioPct = allRevenue > 0 ? (allWalkerPayout / allRevenue * 100).toFixed(1) : "0.0";
  const totalCompletedWalks = allCompletedBookings.length + stripeReceiptsAll.length;
  const revenuePerWalk = totalCompletedWalks > 0 ? allRevenue / totalCompletedWalks : 0;
  const activeClientsList = Object.values(clients).filter(c => !c.deleted);
  const totalClientsCount = activeClientsList.length;
  const activeRecentCount = activeClientsList.filter(c =>
    (c.bookings || []).some(b => !b.cancelled && new Date(b.scheduledDateTime || b.bookedAt) >= thirtyDaysAgo)
  ).length;
  const retainedCount = activeClientsList.filter(c =>
    (c.bookings || []).filter(b => b.adminCompleted && !b.cancelled).length >= 2
  ).length;
  const retentionPct = totalClientsCount > 0 ? Math.round(retainedCount / totalClientsCount * 100) : 0;
  const avgRevPerClient = totalClientsCount > 0 ? allRevenue / totalClientsCount : 0;
  const allUpcomingExt = Object.entries(clients).flatMap(([pin, c]) =>
    (c.bookings || []).filter(b =>
      !b.cancelled && !b.adminCompleted && !b.stripeSessionId &&
      new Date(b.scheduledDateTime || b.bookedAt) > new Date()
    ).map(b => ({
      ...b, clientId: pin,
      clientName: b.clientName || c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "",
    }))
  );
  const pipelineRev = allUpcomingExt.filter(b => !b.isOvernight).reduce((s, b) => s + effectivePrice(b), 0);
  const uninvoicedAmount = Object.values(allUninvoicedByClient).reduce((s, { walks }) =>
    s + walks.reduce((ws, b) => ws + effectivePrice(b), 0), 0);
  const uniqueWalkerNames = new Set(allCompletedBookings.map(b => b.form?.walker).filter(Boolean));
  const activeWalkerCount = uniqueWalkerNames.size;
  const walksPerWalker = activeWalkerCount > 0 ? (allCompletedBookings.length / activeWalkerCount).toFixed(1) : "—";
  const revPerWalker = activeWalkerCount > 0 ? fmt(allRevenue / activeWalkerCount, true) : "—";

  return (
    <div className="fade-up">
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
            fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Financials</div>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
            Revenue, profitability, client health, and collections.
          </p>
        </div>
        {view === "list" && (
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            {bulkWalkCount > 0 && (
              <button onClick={() => setBulkState("confirm")} style={{
                padding: "10px 18px", borderRadius: "10px",
                border: "1.5px solid #D4A843", background: "#FDF5EC",
                color: "#b45309", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", gap: "7px",
              }}>
                ⚡ Submit All Uninvoiced
                <span style={{ background: "#b45309", color: "#fff",
                  borderRadius: "20px", padding: "1px 8px", fontSize: "13px", fontWeight: 700 }}>
                  {bulkWalkCount}
                </span>
              </button>
            )}
            <button onClick={() => { setView("create"); resetCreate(); }} style={{
              padding: "10px 20px", borderRadius: "10px", border: "none",
              background: green, color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "6px",
            }}>
              + New Invoice
            </button>
          </div>
        )}
        {view === "create" && (
          <button onClick={() => setView("list")} style={{
            padding: "10px 20px", borderRadius: "10px",
            border: "1.5px solid #e4e7ec", background: "#fff",
            color: "#374151", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", cursor: "pointer",
          }}>
            ← Back to List
          </button>
        )}
      </div>

      {/* ── Bulk invoice modal ── */}
      {(bulkState === "confirm" || bulkState === "sending" || bulkState === "done") && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500,
          display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div onClick={() => { if (bulkState !== "sending") setBulkState("idle"); }}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
          <div className="fade-up" style={{ position: "relative", background: "#fff",
            borderRadius: "20px", padding: "36px 32px", maxWidth: "440px", width: "100%",
            boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>

            {bulkState === "confirm" && (
              <>
                <div style={{ fontSize: "36px", textAlign: "center", marginBottom: "14px" }}>⚡</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                  fontWeight: 700, color: "#111827", textAlign: "center", marginBottom: "10px" }}>
                  Submit All Uninvoiced Walks?
                </div>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#6b7280", textAlign: "center", lineHeight: "1.65", marginBottom: "20px" }}>
                  This will create and send{" "}
                  <strong style={{ color: "#111827" }}>{bulkClientCount} invoice{bulkClientCount !== 1 ? "s" : ""}</strong>{" "}
                  covering{" "}
                  <strong style={{ color: "#111827" }}>{bulkWalkCount} completed walk{bulkWalkCount !== 1 ? "s" : ""}</strong>{" "}
                  across {bulkClientCount} client{bulkClientCount !== 1 ? "s" : ""}.
                </p>
                <div style={{ background: "#FDF5EC", border: "1.5px solid #D4A843",
                  borderRadius: "12px", padding: "14px 16px", marginBottom: "24px",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#92400e",
                  lineHeight: "1.6" }}>
                  Each client will receive one invoice for all of their outstanding uninvoiced walks.
                  This cannot be undone without voiding individual invoices.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <button onClick={handleBulkSend} style={{
                    width: "100%", padding: "14px", borderRadius: "11px", border: "none",
                    background: "#b45309", color: "#fff",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 700, cursor: "pointer" }}>
                    ⚡ Yes, Submit {bulkWalkCount} Walk{bulkWalkCount !== 1 ? "s" : ""}
                  </button>
                  <button onClick={() => setBulkState("idle")} style={{
                    width: "100%", padding: "14px", borderRadius: "11px",
                    border: "1.5px solid #e4e7ec", background: "#f9fafb",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#374151", cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </>
            )}

            {bulkState === "sending" && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>⏳</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "17px",
                  fontWeight: 600, color: "#111827", marginBottom: "8px" }}>
                  Generating invoices…
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                  Creating {bulkWalkCount} walk{bulkWalkCount !== 1 ? "s" : ""} across {bulkClientCount} client{bulkClientCount !== 1 ? "s" : ""}
                </div>
              </div>
            )}

            {bulkState === "done" && bulkResult && (
              <>
                <div style={{ fontSize: "40px", textAlign: "center", marginBottom: "14px" }}>✅</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                  fontWeight: 700, color: "#111827", textAlign: "center", marginBottom: "10px" }}>
                  All Done!
                </div>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#6b7280", textAlign: "center", lineHeight: "1.65", marginBottom: "24px" }}>
                  <strong style={{ color: "#111827" }}>{bulkResult.clientCount} invoice{bulkResult.clientCount !== 1 ? "s" : ""}</strong> sent
                  covering <strong style={{ color: "#111827" }}>{bulkResult.walkCount} walk{bulkResult.walkCount !== 1 ? "s" : ""}</strong>.
                </p>
                <button onClick={() => { setBulkState("idle"); setBulkResult(null); }}
                  style={{ width: "100%", padding: "14px", borderRadius: "11px", border: "none",
                    background: "#C4541A", color: "#fff",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 600, cursor: "pointer" }}>
                  Back to Invoices
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ LIST VIEW ══ */}
      {view === "list" && (
        <>
          {/* ── Comprehensive KPI Dashboard (expandable drawers) ── */}
          {(() => {
            // ── Shared row/drawer helpers ──
            const rowSt = { display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "9px 0", borderBottom: "1px solid #f3f4f6",
              fontFamily: "'DM Sans', sans-serif", fontSize: "14px" };
            const val = (color = "#111827") => ({ fontWeight: 600, color, fontFamily: "'DM Sans', sans-serif", fontSize: "14px" });
            const sub12 = { fontSize: "12px", color: "#9ca3af", fontFamily: "'DM Sans', sans-serif" };
            const emptyNote = (msg) => (
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af",
                fontStyle: "italic", padding: "12px 0", textAlign: "center" }}>{msg}</div>
            );
            const secHead = (t) => (
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", fontWeight: 700,
                color: "#9ca3af", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px", marginTop: "4px" }}>{t}</div>
            );
            const totalRow = (label, value, color = amber) => (
              <div style={{ ...rowSt, borderBottom: "none", marginTop: "4px" }}>
                <span style={{ fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
                <span style={val(color)}>{value}</span>
              </div>
            );

            // ── Per-walk list row ──
            const walkRow = (b, i) => {
              const d = new Date(b.completedAt || b.scheduledDateTime || b.bookedAt);
              return (
                <div key={i} style={{ ...rowSt, gap: "8px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>
                      {b.clientName || "—"}{b.form?.pet ? ` · ${b.form.pet}` : ""}
                    </div>
                    <div style={sub12}>
                      {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {b.form?.walker ? ` · ${b.form.walker}` : ""}
                      {b.slot?.duration ? ` · ${b.slot.duration}` : ""}
                    </div>
                  </div>
                  <span style={val("#059669")}>${effectivePrice(b).toFixed(2)}</span>
                </div>
              );
            };

            // ── Walker breakdown helper ──
            const walkerBreakdown = (bookingSet) => {
              const bw = {};
              bookingSet.forEach(b => {
                const n = b.form?.walker || "Unassigned";
                if (!bw[n]) bw[n] = { revenue: 0, payout: 0, count: 0 };
                bw[n].revenue += effectivePrice(b);
                bw[n].payout  += getWalkerPayout(b);
                bw[n].count   += 1;
              });
              return Object.entries(bw).sort((a, b) => b[1].revenue - a[1].revenue)
                .map(([name, d]) => ({ name, ...d, profit: d.revenue - d.payout }));
            };

            // ── All drawer content keyed by KPI id ──
            const drawerContent = (id) => {

              // ─ Revenue drawers ─
              if (id === "weekRev") {
                const walks = [...weekCompletedBookings].sort((a, b) =>
                  new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) - new Date(a.completedAt || a.scheduledDateTime || a.bookedAt));
                const stripeWk = stripeReceiptsAll.filter(b => new Date(b.paidAt) >= extWeekMon)
                  .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
                return (<div>
                  {secHead("Completed Walks This Week")}
                  {walks.length === 0 && stripeWk.length === 0
                    ? emptyNote("No revenue recorded this week yet.")
                    : <>{walks.map((b, i) => walkRow(b, i))}
                        {stripeWk.length > 0 && <>{secHead("Stripe Payments This Week")}
                          {stripeWk.map((b, i) => (
                            <div key={i} style={rowSt}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{b.clientName}</div>
                                <div style={sub12}>{new Date(b.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · Stripe</div>
                              </div>
                              <span style={val("#059669")}>${(b.price || 0).toFixed(2)}</span>
                            </div>
                          ))}
                        </>}
                        {totalRow("Week Total", fmt(extWeekRevenue, true), amber)}
                      </>
                  }
                </div>);
              }

              if (id === "monthRev") {
                const walks = [...monthCompletedBookings].sort((a, b) =>
                  new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) - new Date(a.completedAt || a.scheduledDateTime || a.bookedAt));
                const stripeMo = stripeReceiptsAll.filter(b => new Date(b.paidAt) >= thirtyDaysAgo);
                return (<div>
                  {secHead("Last 30 Days — Completed Walks")}
                  {walks.length === 0 && stripeMo.length === 0 ? emptyNote("No revenue in the last 30 days.") : <>
                    {walks.slice(0, 20).map((b, i) => walkRow(b, i))}
                    {walks.length > 20 && <div style={{ ...sub12, padding: "6px 0" }}>+ {walks.length - 20} more walks</div>}
                    {stripeMo.length > 0 && (
                      <div style={rowSt}>
                        <span style={{ color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>Stripe payments (30d)</span>
                        <span style={val("#059669")}>{stripeMo.length} · ${stripeMo.reduce((s, b) => s + (b.price || 0), 0).toFixed(2)}</span>
                      </div>
                    )}
                    {totalRow("30-Day Total", fmt(monthRevenue, true), "#7A4D6E")}
                  </>}
                </div>);
              }

              if (id === "allRev") {
                const revMap = {};
                allCompletedBookings.forEach(b => { const k = b.clientName || "Unknown"; revMap[k] = (revMap[k] || 0) + effectivePrice(b); });
                stripeReceiptsAll.forEach(b => { const k = b.clientName || "Unknown"; revMap[k] = (revMap[k] || 0) + (b.price || 0); });
                const sorted = Object.entries(revMap).sort((a, b) => b[1] - a[1]);
                const maxR = sorted[0]?.[1] || 1;
                return (<div>
                  {secHead(`Top Clients by Lifetime Revenue · ${sorted.length} total`)}
                  {sorted.length === 0 ? emptyNote("No completed walks yet.") : <>
                    {sorted.slice(0, 12).map(([name, rev], i) => (
                      <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#111827" }}>{i + 1}. {name}</span>
                          <span style={val("#059669")}>${rev.toFixed(2)}</span>
                        </div>
                        <div style={{ height: "4px", background: "#f3f4f6", borderRadius: "2px" }}>
                          <div style={{ height: "4px", borderRadius: "2px", background: "#059669", width: `${Math.round(rev / maxR * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                    {sorted.length > 12 && <div style={{ ...sub12, padding: "6px 0" }}>+ {sorted.length - 12} more clients</div>}
                    {totalRow("Lifetime Total", fmt(allRevenue, true), "#059669")}
                  </>}
                </div>);
              }

              if (id === "revPerWalk") {
                const by30 = allCompletedBookings.filter(b => (b.slot?.duration || "30 min") === "30 min");
                const by60 = allCompletedBookings.filter(b => b.slot?.duration === "60 min");
                return (<div>
                  {secHead("Revenue Breakdown by Service Type")}
                  {[
                    { label: "30-min walks", count: by30.length, rev: by30.reduce((s, b) => s + effectivePrice(b), 0) },
                    { label: "60-min walks", count: by60.length, rev: by60.reduce((s, b) => s + effectivePrice(b), 0) },
                    { label: "Stripe at-booking", count: stripeReceiptsAll.length, rev: stripeTotal },
                  ].map(({ label, count, rev }, i) => (
                    <div key={i} style={rowSt}>
                      <div>
                        <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{label}</div>
                        <div style={sub12}>{count} · avg ${count > 0 ? (rev / count).toFixed(2) : "0.00"}</div>
                      </div>
                      <span style={val()}>${rev.toFixed(2)}</span>
                    </div>
                  ))}
                  {totalRow("Overall avg / walk", `$${revenuePerWalk.toFixed(2)}`, "#3D6B7A")}
                </div>);
              }

              // ─ Profitability drawers ─
              if (id === "grossProfit" || id === "laborRatio") {
                const rows = walkerBreakdown(allCompletedBookings);
                return (<div>
                  {secHead("Lifetime Profit by Walker")}
                  {rows.length === 0 ? emptyNote("No completed walks yet.") : <>
                    {rows.map((r, i) => (
                      <div key={i} style={rowSt}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{r.name}</div>
                          <div style={sub12}>{r.count} walk{r.count !== 1 ? "s" : ""} · pay ${r.payout.toFixed(0)} · {r.revenue > 0 ? Math.round(r.profit / r.revenue * 100) : 0}% margin</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={val("#059669")}>${r.profit.toFixed(0)}</div>
                          <div style={sub12}>of ${r.revenue.toFixed(0)}</div>
                        </div>
                      </div>
                    ))}
                    {totalRow("Total Gross Profit", fmt(grossProfit, true), "#059669")}
                  </>}
                </div>);
              }

              if (id === "grossMargin") {
                const margin = parseFloat(grossMarginPct);
                return (<div>
                  {secHead("Margin Summary")}
                  {[
                    ["Total Revenue", fmt(allRevenue, true), "#111827"],
                    ["Walker Payouts", `-$${allWalkerPayout.toFixed(0)}`, "#dc2626"],
                    ["Gross Profit",   fmt(grossProfit, true), "#059669"],
                    ["Gross Margin",  `${grossMarginPct}%`, "#059669"],
                  ].map(([label, v, color], i) => (
                    <div key={i} style={rowSt}>
                      <span style={{ color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
                      <span style={val(color)}>{v}</span>
                    </div>
                  ))}
                  <div style={{ background: "#f0fdf4", border: "1px solid #a8d5bf", borderRadius: "10px",
                    padding: "10px 14px", marginTop: "12px", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#059669" }}>
                    💡 Industry target: 40–60% gross margin.{" "}
                    {margin >= 40 ? "You're in the healthy range ✓"
                      : margin > 0 ? "Below target — consider adjusting pricing or payout rates."
                      : "No data yet."}
                  </div>
                </div>);
              }

              if (id === "weekProfit") {
                const rows = walkerBreakdown(weekCompletedBookings);
                return (<div>
                  {secHead("This Week's Walker Breakdown")}
                  {rows.length === 0 ? emptyNote("No completed walks this week.") : <>
                    {rows.map((r, i) => (
                      <div key={i} style={rowSt}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{r.name}</div>
                          <div style={sub12}>{r.count} walk{r.count !== 1 ? "s" : ""} · walker pay ${r.payout.toFixed(0)}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={val("#059669")}>+${r.profit.toFixed(0)}</div>
                          <div style={sub12}>rev ${r.revenue.toFixed(0)}</div>
                        </div>
                      </div>
                    ))}
                    {totalRow("Week Profit", fmt(weekProfit, true), amber)}
                  </>}
                </div>);
              }

              // ─ Operations drawers ─
              if (id === "completedWalks") {
                const sorted = [...allCompletedBookings].sort((a, b) =>
                  new Date(b.completedAt || b.scheduledDateTime || b.bookedAt) - new Date(a.completedAt || a.scheduledDateTime || a.bookedAt));
                return (<div>
                  {secHead(`${sorted.length} Total Completed — Most Recent`)}
                  {sorted.length === 0 ? emptyNote("No completed walks yet.") : <>
                    {sorted.slice(0, 20).map((b, i) => walkRow(b, i))}
                    {sorted.length > 20 && <div style={{ ...sub12, padding: "6px 0" }}>+ {sorted.length - 20} older walks</div>}
                  </>}
                </div>);
              }

              if (id === "activeWalkers" || id === "walksPerWalker" || id === "revPerWalker") {
                const rows = walkerBreakdown(allCompletedBookings);
                return (<div>
                  {secHead(`${rows.length} Walker${rows.length !== 1 ? "s" : ""} — Revenue & Efficiency`)}
                  {rows.length === 0 ? emptyNote("No walker data yet.") : rows.map((r, i) => (
                    <div key={i} style={rowSt}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{r.name}</div>
                        <div style={sub12}>{r.count} walks · payout ${r.payout.toFixed(0)} · profit ${r.profit.toFixed(0)}</div>
                      </div>
                      <span style={val("#7A4D6E")}>${r.revenue.toFixed(0)}</span>
                    </div>
                  ))}
                </div>);
              }

              // ─ Client Health drawers ─
              if (id === "totalClients" || id === "avgRevPerClient") {
                const data = activeClientsList.map(c => {
                  const done = (c.bookings || []).filter(b => b.adminCompleted && !b.cancelled);
                  return { name: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown",
                    rev: done.reduce((s, b) => s + effectivePrice(b), 0), count: done.length };
                }).sort((a, b) => b.rev - a.rev);
                const maxR = data[0]?.rev || 1;
                return (<div>
                  {secHead(`${data.length} Active Clients by Lifetime Spend`)}
                  {data.length === 0 ? emptyNote("No active clients.") : <>
                    {data.slice(0, 15).map((c, i) => (
                      <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#111827" }}>{c.name}</span>
                          <span style={val(c.rev > 0 ? "#C4541A" : "#9ca3af")}>${c.rev.toFixed(2)}</span>
                        </div>
                        <div style={{ ...sub12, marginBottom: "3px" }}>{c.count} completed walk{c.count !== 1 ? "s" : ""}</div>
                        {c.rev > 0 && <div style={{ height: "3px", background: "#f3f4f6", borderRadius: "2px" }}>
                          <div style={{ height: "3px", borderRadius: "2px", background: "#C4541A", width: `${Math.round(c.rev / maxR * 100)}%` }} />
                        </div>}
                      </div>
                    ))}
                    {data.length > 15 && <div style={{ ...sub12, padding: "6px 0" }}>+ {data.length - 15} more clients</div>}
                  </>}
                </div>);
              }

              if (id === "active30d") {
                const recent = activeClientsList.map(c => {
                  const rb = (c.bookings || []).filter(b => !b.cancelled && new Date(b.scheduledDateTime || b.bookedAt) >= thirtyDaysAgo);
                  const last = rb.sort((a, b) => new Date(b.scheduledDateTime || b.bookedAt) - new Date(a.scheduledDateTime || a.bookedAt))[0];
                  return last ? { name: c.name || "Unknown", last, count: rb.length } : null;
                }).filter(Boolean).sort((a, b) => new Date(b.last.scheduledDateTime || b.last.bookedAt) - new Date(a.last.scheduledDateTime || a.last.bookedAt));
                return (<div>
                  {secHead(`${recent.length} Client${recent.length !== 1 ? "s" : ""} Active in Last 30 Days`)}
                  {recent.length === 0 ? emptyNote("No clients with recent bookings.") : recent.map((c, i) => {
                    const d = new Date(c.last.scheduledDateTime || c.last.bookedAt);
                    return (
                      <div key={i} style={rowSt}>
                        <div>
                          <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{c.name}</div>
                          <div style={sub12}>Last: {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {c.count} booking{c.count !== 1 ? "s" : ""} this period</div>
                        </div>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 600,
                          color: "#059669", background: "#f0fdf4", border: "1px solid #a8d5bf", borderRadius: "5px", padding: "2px 8px" }}>Active</span>
                      </div>
                    );
                  })}
                </div>);
              }

              if (id === "retentionRate") {
                const repeat  = activeClientsList.filter(c => (c.bookings || []).filter(b => b.adminCompleted && !b.cancelled).length >= 2);
                const oneTime = activeClientsList.filter(c => (c.bookings || []).filter(b => b.adminCompleted && !b.cancelled).length === 1);
                const never   = activeClientsList.filter(c => (c.bookings || []).filter(b => b.adminCompleted && !b.cancelled).length === 0);
                return (<div>
                  {secHead("Client Breakdown by Booking History")}
                  {[
                    { label: "Repeat clients (2+ walks)", list: repeat,  color: "#059669", bg: "#f0fdf4" },
                    { label: "One-time clients",          list: oneTime, color: "#b45309", bg: "#fffbeb" },
                    { label: "No completed walks yet",    list: never,   color: "#9ca3af", bg: "#f9fafb" },
                  ].map(({ label, list, color, bg }) => (
                    <div key={label} style={{ background: bg, border: `1px solid ${color}33`, borderRadius: "10px", padding: "10px 14px", marginBottom: "8px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700, color, marginBottom: "4px" }}>
                        {label} — {list.length}
                      </div>
                      {list.length > 0 && (
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#6b7280", lineHeight: "1.6" }}>
                          {list.slice(0, 8).map(c => c.name || "Unknown").join(", ")}{list.length > 8 ? ` + ${list.length - 8} more` : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>);
              }

              // ─ Pipeline & Cash drawers ─
              if (id === "pipelineRev") {
                const upcoming = allUpcomingExt.filter(b => !b.isOvernight)
                  .sort((a, b) => new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt));
                return (<div>
                  {secHead(`${upcoming.length} Upcoming Walk${upcoming.length !== 1 ? "s" : ""} — Expected Revenue`)}
                  {upcoming.length === 0 ? emptyNote("No upcoming walks scheduled.") : <>
                    {upcoming.slice(0, 20).map((b, i) => {
                      const d = new Date(b.scheduledDateTime || b.bookedAt);
                      return (
                        <div key={i} style={rowSt}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>
                              {b.clientName || "—"}{b.form?.pet ? ` · ${b.form.pet}` : ""}
                            </div>
                            <div style={sub12}>
                              {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {b.form?.walker || "Unassigned"} · {b.slot?.duration || "30 min"}
                            </div>
                          </div>
                          <span style={val("#7A4D6E")}>${effectivePrice(b).toFixed(2)}</span>
                        </div>
                      );
                    })}
                    {upcoming.length > 20 && <div style={{ ...sub12, padding: "6px 0" }}>+ {upcoming.length - 20} more walks</div>}
                    {totalRow("Pipeline Total", fmt(pipelineRev, true), "#7A4D6E")}
                  </>}
                </div>);
              }

              if (id === "uninvoiced") {
                const byClient = Object.entries(allUninvoicedByClient).map(([, { client: c, walks }]) => ({
                  name: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown",
                  count: walks.length, total: walks.reduce((s, b) => s + effectivePrice(b), 0),
                })).sort((a, b) => b.total - a.total);
                return (<div>
                  {secHead(`${byClient.length} Client${byClient.length !== 1 ? "s" : ""} with Uninvoiced Walks`)}
                  {byClient.length === 0 ? emptyNote("All completed walks have been invoiced 🎉") : <>
                    {byClient.map((c, i) => (
                      <div key={i} style={rowSt}>
                        <div>
                          <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{c.name}</div>
                          <div style={sub12}>{c.count} uninvoiced walk{c.count !== 1 ? "s" : ""}</div>
                        </div>
                        <span style={val(amber)}>${c.total.toFixed(2)}</span>
                      </div>
                    ))}
                    {totalRow("Total Unbilled", fmt(uninvoicedAmount, true), amber)}
                  </>}
                </div>);
              }

              if (id === "refundsWeek" || id === "refundsAll") {
                const pool = id === "refundsWeek"
                  ? allRefundedBookings.filter(b => b.refundedAt && new Date(b.refundedAt) >= refundWeekMon)
                  : allRefundedBookings;
                const enriched = pool.map(b => {
                  const entry = Object.values(clients).find(c => (c.bookings || []).some(x => x.key === b.key));
                  return { ...b, clientName: entry?.name || b.clientName || "Unknown" };
                }).sort((a, b) => new Date(b.refundedAt || b.cancelledAt || 0) - new Date(a.refundedAt || a.cancelledAt || 0));
                const total = enriched.reduce((s, b) => s + (b.refundAmount || 0), 0);
                return (<div>
                  {secHead(`${enriched.length} Refund${enriched.length !== 1 ? "s" : ""} ${id === "refundsWeek" ? "This Week" : "Lifetime"}`)}
                  {enriched.length === 0 ? emptyNote("No refunds issued.") : <>
                    {enriched.slice(0, 20).map((b, i) => (
                      <div key={i} style={rowSt}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{b.clientName}</div>
                          <div style={sub12}>
                            {b.refundedAt ? new Date(b.refundedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                            {b.refundPercent != null ? ` · ${Math.round(b.refundPercent * 100)}% back` : ""}
                          </div>
                        </div>
                        <span style={val("#dc2626")}>−${(b.refundAmount || 0).toFixed(2)}</span>
                      </div>
                    ))}
                    {enriched.length > 20 && <div style={{ ...sub12, padding: "6px 0" }}>+ {enriched.length - 20} more</div>}
                    {totalRow("Total Refunded", `-$${total.toFixed(2)}`, "#dc2626")}
                  </>}
                </div>);
              }

              // ─ Stripe drawers ─
              if (id === "stripeWeek") {
                const wk = stripeReceiptsAll.filter(b => new Date(b.paidAt) >= extWeekMon)
                  .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
                return (<div>
                  {secHead(`${wk.length} Stripe Payment${wk.length !== 1 ? "s" : ""} This Week`)}
                  {wk.length === 0 ? emptyNote("No Stripe payments this week.") : <>
                    {wk.map((b, i) => (
                      <div key={i} style={rowSt}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{b.clientName}</div>
                          <div style={sub12}>{new Date(b.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {b.slot?.duration || "—"}</div>
                        </div>
                        <span style={val("#059669")}>${(b.price || 0).toFixed(2)}</span>
                      </div>
                    ))}
                    {totalRow("Week Total", fmt(stripeTotalWeek, true), green)}
                  </>}
                </div>);
              }

              if (id === "stripeAll") {
                return (<div>
                  {secHead(`${stripeReceiptsAll.length} Total Stripe Payments`)}
                  {stripeReceiptsAll.length === 0 ? emptyNote("No Stripe payments yet.") : <>
                    {stripeReceiptsAll.slice(0, 20).map((b, i) => (
                      <div key={i} style={rowSt}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#111827", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>{b.clientName}</div>
                          <div style={sub12}>{new Date(b.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {b.slot?.duration || "—"}</div>
                        </div>
                        <span style={val("#059669")}>${(b.price || 0).toFixed(2)}</span>
                      </div>
                    ))}
                    {stripeReceiptsAll.length > 20 && <div style={{ ...sub12, padding: "6px 0" }}>+ {stripeReceiptsAll.length - 20} more · see Stripe filter tab below</div>}
                    {totalRow("Lifetime Total", fmt(stripeTotal, true), "#059669")}
                  </>}
                </div>);
              }

              return null;
            };

            // ── Section + expandable card renderer ──
            const sectionLabel = (title) => (
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700,
                color: "#9ca3af", textTransform: "uppercase", letterSpacing: "1px",
                marginBottom: "8px", marginTop: "16px" }}>{title}</div>
            );

            const renderSection = (title, kpis) => (
              <div key={title}>
                {sectionLabel(title)}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "4px" }}>
                  {kpis.map(kpi => {
                    const isOpen = expandedFinKpi === kpi.id;
                    return (
                      <div key={kpi.id} onClick={() => setExpandedFinKpi(isOpen ? null : kpi.id)}
                        style={{ gridColumn: isOpen ? "1 / -1" : undefined,
                          background: isOpen ? "#fff" : kpi.bg,
                          border: `1.5px solid ${isOpen ? kpi.color + "55" : kpi.border}`,
                          borderRadius: "14px", overflow: "hidden", cursor: "pointer",
                          transition: "border-color 0.2s, box-shadow 0.2s",
                          boxShadow: isOpen ? `0 4px 16px ${kpi.color}18` : "none" }}>
                        <div style={{ padding: "14px 16px", position: "relative", background: isOpen ? `${kpi.color}08` : kpi.bg }}>
                          <div style={{ position: "absolute", top: "10px", right: "12px",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                            color: isOpen ? kpi.color : "#d1d5db",
                            transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s, color 0.2s" }}>▾</div>
                          <div style={{ paddingRight: "20px" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700,
                              color: kpi.color, textTransform: "uppercase", letterSpacing: "1px",
                              marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kpi.label}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                              fontWeight: 700, color: "#111827", lineHeight: 1, overflowWrap: "anywhere" }}>{kpi.value}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                              color: "#6b7280", marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kpi.sub}</div>
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ borderTop: `1px solid ${kpi.color}22`, padding: "16px 16px 18px", background: `${kpi.color}05` }}
                            onClick={e => e.stopPropagation()}>
                            {drawerContent(kpi.id)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );

            const sections = [
              { title: "💰 Revenue", kpis: [
                { id: "weekRev",    label: "Week's Revenue",   value: fmt(extWeekRevenue, true),      sub: "completed + stripe this week",           color: amber,      bg: "#fffbeb", border: "#fde68a" },
                { id: "monthRev",   label: "Month's Revenue",  value: fmt(monthRevenue, true),        sub: "last 30 days",                           color: "#7A4D6E",  bg: "#F7F0F5", border: "#D8ABCF" },
                { id: "allRev",     label: "All-Time Revenue", value: fmt(allRevenue, true),          sub: `${allCompletedBookings.length} completed walks`, color: "#059669", bg: "#f0fdf4", border: "#a8d5bf" },
                { id: "revPerWalk", label: "Revenue / Walk",   value: `$${revenuePerWalk.toFixed(2)}`, sub: `avg across ${totalCompletedWalks} walks`, color: "#3D6B7A", bg: "#f0f9ff", border: "#bae6fd" },
              ]},
              { title: "📈 Profitability", kpis: [
                { id: "grossProfit", label: "Gross Profit",  value: fmt(grossProfit, true),   sub: "revenue minus walker pay",              color: "#059669", bg: "#f0fdf4", border: "#a8d5bf" },
                { id: "grossMargin", label: "Gross Margin",  value: `${grossMarginPct}%`,     sub: "of revenue kept after payout",          color: "#7A4D6E", bg: "#F7F0F5", border: "#D8ABCF" },
                { id: "weekProfit",  label: "Week's Profit", value: fmt(weekProfit, true),    sub: "this week",                             color: amber,     bg: "#fffbeb", border: "#fde68a" },
                { id: "laborRatio",  label: "Walker Pay %",  value: `${laborRatioPct}%`,      sub: `$${allWalkerPayout.toFixed(0)} paid out lifetime`, color: "#C4541A", bg: "#FDF5EC", border: "#D4A843" },
              ]},
              { title: "🐕 Operations & Labor", kpis: [
                { id: "completedWalks", label: "Completed Walks",  value: allCompletedBookings.length, sub: "admin-marked complete",               color: "#059669", bg: "#f0fdf4", border: "#a8d5bf" },
                { id: "activeWalkers",  label: "Active Walkers",   value: activeWalkerCount || "—",    sub: "with completed walk history",          color: "#C4541A", bg: "#FDF5EC", border: "#D4A843" },
                { id: "walksPerWalker", label: "Walks / Walker",   value: walksPerWalker,              sub: "avg completed walks each",             color: "#3D6B7A", bg: "#f0f9ff", border: "#bae6fd" },
                { id: "revPerWalker",   label: "Revenue / Walker", value: revPerWalker,                sub: "lifetime revenue per walker",          color: "#7A4D6E", bg: "#F7F0F5", border: "#D8ABCF" },
              ]},
              { title: "👥 Client Health", kpis: [
                { id: "totalClients",    label: "Total Clients",    value: totalClientsCount,               sub: "active accounts",              color: "#C4541A", bg: "#FDF5EC", border: "#D4A843" },
                { id: "active30d",       label: "Active (30d)",     value: activeRecentCount,               sub: "booked in last 30 days",       color: "#059669", bg: "#f0fdf4", border: "#a8d5bf" },
                { id: "retentionRate",   label: "Retention Rate",   value: `${retentionPct}%`,              sub: `${retainedCount} repeat clients`, color: "#3D6B7A", bg: "#f0f9ff", border: "#bae6fd" },
                { id: "avgRevPerClient", label: "Avg Rev / Client", value: `$${avgRevPerClient.toFixed(2)}`, sub: "lifetime spend per client",  color: "#7A4D6E", bg: "#F7F0F5", border: "#D8ABCF" },
              ]},
              { title: "🔮 Pipeline & Cash", kpis: [
                { id: "pipelineRev",  label: "Pipeline Revenue",  value: fmt(pipelineRev, true),  sub: `${allUpcomingExt.filter(b => !b.isOvernight).length} upcoming walks`, color: "#7A4D6E", bg: "#F7F0F5", border: "#D8ABCF" },
                { id: "uninvoiced",   label: "Uninvoiced $",      value: uninvoicedAmount > 0 ? fmt(uninvoicedAmount, true) : "—", sub: `${bulkWalkCount} walk${bulkWalkCount !== 1 ? "s" : ""} unbilled`, color: amber, bg: "#fffbeb", border: "#fde68a" },
                { id: "refundsWeek",  label: "Refunds This Week", value: refundsThisWeek > 0 ? fmt(refundsThisWeek, true) : "—", sub: `${refundCountWeek} refund${refundCountWeek !== 1 ? "s" : ""} issued`, color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
                { id: "refundsAll",   label: "Refunds Lifetime",  value: refundsLifetime > 0 ? fmt(refundsLifetime, true) : "—", sub: `${refundCountLifetime} total`, color: "#9ca3af", bg: "#f9fafb", border: "#e4e7ec" },
              ]},
              { title: "💳 Stripe Collections", kpis: [
                { id: "stripeWeek", label: "Weekly Charges", value: fmt(stripeTotalWeek, true), sub: `${stripeCountWeek} payment${stripeCountWeek !== 1 ? "s" : ""} this week`, color: green, bg: "#FDF5EC", border: "#D4A843" },
                { id: "stripeAll",  label: "Total Charges",  value: fmt(stripeTotal, true),     sub: `${stripeReceiptsAll.length} payment${stripeReceiptsAll.length !== 1 ? "s" : ""} lifetime`, color: "#059669", bg: "#f0fdf4", border: "#a8d5bf" },
              ]},
            ];

            return (
              <div style={{ marginBottom: "24px" }}>
                {sections.map(s => renderSection(s.title, s.kpis))}
              </div>
            );
          })()}

          {/* Search */}
          <div style={{ position: "relative", marginBottom: "12px" }}>
            <span style={{ position: "absolute", left: "12px", top: "50%",
              transform: "translateY(-50%)", fontSize: "15px", pointerEvents: "none" }}>🔍</span>
            <input value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)}
              placeholder="Search by client name, email, or invoice ID…"
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 36px",
                borderRadius: "10px", border: "1.5px solid #e4e7ec",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#111827", outline: "none", background: "#fff" }} />
            {invoiceSearch && (
              <button onClick={() => setInvoiceSearch("")}
                style={{ position: "absolute", right: "10px", top: "50%",
                  transform: "translateY(-50%)", background: "none", border: "none",
                  cursor: "pointer", color: "#9ca3af", fontSize: "16px", lineHeight: 1 }}>✕</button>
            )}
          </div>

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
            {[
              { id: "all", label: "All" },
              { id: "stripe", label: `Stripe (${stripeReceiptsAll.length})` },
              { id: "refunds", label: `Refunds (${allRefundedBookings.length})` },
            ].map(f => (
              <button key={f.id} onClick={() => setFilterStatus(f.id)} style={{
                padding: "6px 14px", borderRadius: "20px", cursor: "pointer",
                border: `1.5px solid ${filterStatus === f.id ? green : "#e4e7ec"}`,
                background: filterStatus === f.id ? green : "#fff",
                color: filterStatus === f.id ? "#fff" : "#6b7280",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                fontWeight: filterStatus === f.id ? 600 : 400,
              }}>{f.label}</button>
            ))}
          </div>

          {/* Stripe payments + refunds */}
          {filterStatus === "stripe" && (() => {
            const netStripe = stripeTotal - stripeRefundTotal;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Net summary bar */}
                {(stripeReceiptsAll.length > 0 || stripeRefundRows.length > 0) && (
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    {[
                      { label: "Collected", value: `$${stripeTotal.toFixed(2)}`, color: "#059669", bg: "#f0fdf4", border: "#a7f3d0" },
                      { label: "Refunded",  value: stripeRefundTotal > 0 ? `−$${stripeRefundTotal.toFixed(2)}` : "$0.00", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
                      { label: "Net",       value: `$${netStripe.toFixed(2)}`, color: netStripe >= 0 ? "#0b1423" : "#dc2626", bg: "#f9fafb", border: "#e4e7ec" },
                    ].map(s => (
                      <div key={s.label} style={{ flex: "1 1 100px", background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: "12px", padding: "12px 16px" }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "#6b7280", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: s.color }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Payments section */}
                {stripeReceiptsAll.length === 0 ? (
                  <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                    borderRadius: "16px", padding: "32px", textAlign: "center" }}>
                    <div style={{ fontSize: "28px", marginBottom: "10px" }}>💳</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      fontWeight: 600, color: "#374151", marginBottom: "4px" }}>No Stripe payments yet</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                      Payments made at booking time will appear here.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                      Payments ({stripeReceiptsAll.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {stripeReceiptsAll.map(b => {
                  const isExp = expandedInv === b.key;
                  const svcLabel = b.service === "dog" ? "Dog Walk" : b.service === "cat" ? "Cat Visit" : "Meet & Greet";
                  return (
                    <div key={b.key} style={{ background: "#fff",
                      border: isExp ? `2px solid ${green}` : "1.5px solid #d1fae5",
                      borderRadius: "16px", overflow: "hidden", transition: "all 0.15s" }}>
                      <button onClick={() => setExpandedInv(isExp ? null : b.key)}
                        style={{ width: "100%", background: "none", border: "none",
                          cursor: "pointer", padding: "16px 18px", textAlign: "left" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "4px" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "#111827" }}>
                                {b.clientName}
                              </span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700,
                                color: "#059669", background: "#d1fae5", border: "1px solid #a7f3d0",
                                borderRadius: "5px", padding: "1px 7px" }}>STRIPE PAID</span>
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                              {svcLabel} · {b.day}, {b.date} · {b.slot?.time || "—"} ({b.slot?.duration || "—"})
                              {b.form?.walker ? ` · ${b.form.walker}` : ""}
                              {b.paidAt ? ` · ${new Date(b.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0, textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "#059669" }}>
                              ${(b.price || 0).toFixed(2)}
                            </div>
                            <div style={{ fontSize: "14px", color: isExp ? green : "#d1d5db",
                              transform: isExp ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</div>
                          </div>
                        </div>
                      </button>
                      {isExp && (
                        <div style={{ borderTop: "1px solid #f3f4f6", padding: "14px 18px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280", marginBottom: "6px" }}>
                            <strong style={{ color: "#374151" }}>Client:</strong> {b.clientName} · {b.clientEmail}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280", marginBottom: "6px" }}>
                            <strong style={{ color: "#374151" }}>Pet:</strong> {b.form?.pet || "—"}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280", marginBottom: "6px" }}>
                            <strong style={{ color: "#374151" }}>Walker:</strong> {b.form?.walker || "Unassigned"}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                            💳 Stripe Session: {b.stripeSessionId}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                    </div>
                  </div>
                )}

                {/* Stripe Refunds section */}
                {stripeRefundRows.length > 0 && (
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                      Refunds ({stripeRefundRows.length}) · −${stripeRefundTotal.toFixed(2)}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {stripeRefundRows.map(b => {
                        const isExp = expandedInv === b.key + "_srefund";
                        const svcLabel = b.service === "dog" ? "Dog Walk" : b.service === "cat" ? "Cat Visit" : b.service === "overnight" ? "Overnight" : b.service || "Service";
                        const refundPct = b.refundPercent != null ? Math.round(b.refundPercent * 100) : null;
                        const refundDate = b.refundedAt || b.cancelledAt;
                        return (
                          <div key={b.key + "_srefund"} style={{
                            background: "#fff", border: isExp ? "2px solid #dc2626" : "1.5px solid #fecaca",
                            borderRadius: "16px", overflow: "hidden", transition: "all 0.15s",
                          }}>
                            <button onClick={() => setExpandedInv(isExp ? null : b.key + "_srefund")}
                              style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "16px 18px", textAlign: "left" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "4px" }}>
                                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "#111827" }}>{b.clientName}</span>
                                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700,
                                      color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "5px", padding: "1px 7px" }}>STRIPE REFUND</span>
                                    {refundPct != null && (
                                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#6b7280", background: "#f3f4f6", borderRadius: "5px", padding: "1px 7px" }}>{refundPct}%</span>
                                    )}
                                  </div>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                                    {svcLabel} · {b.day ? `${b.day}, ` : ""}{b.date || "—"} · {b.slot?.time || "—"}
                                    {refundDate ? ` · Refunded ${new Date(refundDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                                  </div>
                                </div>
                                <div style={{ flexShrink: 0, textAlign: "right" }}>
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "#dc2626" }}>−${(b.refundAmount || 0).toFixed(2)}</div>
                                  {b.price != null && (
                                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "#9ca3af" }}>of ${(b.price || 0).toFixed(2)}</div>
                                  )}
                                  <div style={{ fontSize: "14px", color: isExp ? "#dc2626" : "#d1d5db", transform: isExp ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</div>
                                </div>
                              </div>
                            </button>
                            {isExp && (
                              <div style={{ borderTop: "1px solid #fef2f2", padding: "14px 18px", display: "flex", flexDirection: "column", gap: "6px" }}>
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                                  <strong style={{ color: "#374151" }}>Client:</strong> {b.clientName} · {b.clientEmail}
                                </div>
                                {b.form?.pet && (
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                                    <strong style={{ color: "#374151" }}>Pet:</strong> {b.form.pet}
                                  </div>
                                )}
                                {b.form?.walker && (
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                                    <strong style={{ color: "#374151" }}>Walker:</strong> {b.form.walker}
                                  </div>
                                )}
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                                  <strong style={{ color: "#374151" }}>Original Charge:</strong> ${(b.price || 0).toFixed(2)}
                                  {refundPct != null ? ` · ${refundPct}% refund = ` : " → "}
                                  <strong style={{ color: "#dc2626" }}>${(b.refundAmount || 0).toFixed(2)} refunded</strong>
                                </div>
                                {b.cancelledAt && (
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                                    <strong style={{ color: "#374151" }}>Cancelled:</strong>{" "}
                                    {new Date(b.cancelledAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                                  </div>
                                )}
                                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                                  <strong style={{ color: "#374151" }}>Stripe Refund ID:</strong>{" "}
                                  <span style={{ fontFamily: "monospace" }}>{b.refundId}</span>
                                </div>
                                {b.stripeSessionId && (
                                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                                    <strong style={{ color: "#374151" }}>Session:</strong>{" "}
                                    <span style={{ fontFamily: "monospace" }}>{b.stripeSessionId}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Empty state when truly nothing */}
                {stripeReceiptsAll.length === 0 && stripeRefundRows.length === 0 && (
                  <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                    borderRadius: "16px", padding: "40px", textAlign: "center" }}>
                    <div style={{ fontSize: "32px", marginBottom: "12px" }}>💳</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      fontWeight: 600, color: "#374151", marginBottom: "4px" }}>No Stripe activity yet</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                      Payments made at booking time will appear here.
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Refunds list */}
          {filterStatus === "refunds" && (() => {
            // Enrich each refunded booking with its client info
            const refundRows = Object.entries(clients).flatMap(([pin, c]) =>
              (c.bookings || [])
                .filter(b => b.refundAmount > 0)
                .map(b => ({
                  ...b,
                  clientPin: pin,
                  clientName: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "—",
                  clientEmail: c.email || "—",
                }))
            ).sort((a, b) => new Date(b.refundedAt || b.cancelledAt || 0) - new Date(a.refundedAt || a.cancelledAt || 0));

            if (refundRows.length === 0) return (
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "16px", padding: "40px", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "12px" }}>↩️</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                  fontWeight: 600, color: "#374151", marginBottom: "4px" }}>No refunds yet</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                  Refunds issued on cancelled bookings will appear here.
                </div>
              </div>
            );

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {refundRows.map(b => {
                  const isExp = expandedInv === b.key + "_refund";
                  const svcLabel = b.service === "dog" ? "Dog Walk" : b.service === "cat" ? "Cat Visit" : b.service === "overnight" ? "Overnight" : b.service || "Service";
                  const refundPct = b.refundPercent != null ? Math.round(b.refundPercent * 100) : null;
                  const refundDate = b.refundedAt || b.cancelledAt;
                  const isStripe = !!b.refundId;
                  return (
                    <div key={b.key + "_refund"} style={{
                      background: "#fff",
                      border: isExp ? "2px solid #dc2626" : "1.5px solid #fecaca",
                      borderRadius: "16px", overflow: "hidden", transition: "all 0.15s",
                    }}>
                      <button onClick={() => setExpandedInv(isExp ? null : b.key + "_refund")}
                        style={{ width: "100%", background: "none", border: "none",
                          cursor: "pointer", padding: "16px 18px", textAlign: "left" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "4px" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "#111827" }}>
                                {b.clientName}
                              </span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700,
                                color: isStripe ? "#dc2626" : "#b45309",
                                background: isStripe ? "#fef2f2" : "#fffbeb",
                                border: `1px solid ${isStripe ? "#fecaca" : "#fde68a"}`,
                                borderRadius: "5px", padding: "1px 7px" }}>
                                {isStripe ? "STRIPE REFUND" : "MANUAL REFUND"}
                              </span>
                              {refundPct != null && (
                                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                                  color: "#6b7280", background: "#f3f4f6",
                                  borderRadius: "5px", padding: "1px 7px" }}>
                                  {refundPct}%
                                </span>
                              )}
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                              {svcLabel} · {b.day ? `${b.day}, ` : ""}{b.date || "—"} · {b.slot?.time || "—"}
                              {refundDate ? ` · Refunded ${new Date(refundDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0, textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "#dc2626" }}>
                              −${(b.refundAmount || 0).toFixed(2)}
                            </div>
                            {b.price != null && (
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "#9ca3af" }}>
                                of ${(b.price || 0).toFixed(2)}
                              </div>
                            )}
                            <div style={{ fontSize: "14px", color: isExp ? "#dc2626" : "#d1d5db",
                              transform: isExp ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</div>
                          </div>
                        </div>
                      </button>
                      {isExp && (
                        <div style={{ borderTop: "1px solid #fef2f2", padding: "14px 18px",
                          display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                            <strong style={{ color: "#374151" }}>Client:</strong> {b.clientName} · {b.clientEmail}
                          </div>
                          {b.form?.pet && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                              <strong style={{ color: "#374151" }}>Pet:</strong> {b.form.pet}
                            </div>
                          )}
                          {b.form?.walker && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                              <strong style={{ color: "#374151" }}>Walker:</strong> {b.form.walker}
                            </div>
                          )}
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                            <strong style={{ color: "#374151" }}>Original Charge:</strong> ${(b.price || 0).toFixed(2)}
                            {refundPct != null ? ` · ${refundPct}% refund = ` : " → "}
                            <strong style={{ color: "#dc2626" }}>${(b.refundAmount || 0).toFixed(2)} refunded</strong>
                          </div>
                          {b.cancelledAt && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                              <strong style={{ color: "#374151" }}>Cancelled:</strong>{" "}
                              {new Date(b.cancelledAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                            </div>
                          )}
                          {b.refundId && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                              <strong style={{ color: "#374151" }}>Stripe Refund ID:</strong>{" "}
                              <span style={{ fontFamily: "monospace" }}>{b.refundId}</span>
                            </div>
                          )}
                          {b.stripeSessionId && (
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                              <strong style={{ color: "#374151" }}>Session:</strong>{" "}
                              <span style={{ fontFamily: "monospace" }}>{b.stripeSessionId}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Admin invoice list (non-Stripe, non-Refunds) */}
          {filterStatus !== "stripe" && filterStatus !== "refunds" && (filtered.length === 0 ? (
            <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
              borderRadius: "16px", padding: "40px", textAlign: "center" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>🧾</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                {invoiceSearch ? "No matching invoices" : "No invoices yet"}
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>
                {invoiceSearch ? `No invoices match "${invoiceSearch}"` : 'Click "New Invoice" to create and send your first one.'}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {filtered.map(inv => {
                // Find which client this belongs to
                const clientEntry = Object.entries(clients).find(([, c]) =>
                  (c.invoices || []).some(i => i.id === inv.id)
                );
                const clientId = clientEntry?.[0];
                const meta = invoiceStatusMeta(inv.status, inv.dueDate);
                const isExpanded = expandedInv === inv.id;
                return (
                  <div key={inv.id} style={{
                    background: "#fff", border: isExpanded ? `2px solid ${green}` : "1.5px solid #e4e7ec",
                    borderRadius: "16px", overflow: "hidden",
                    boxShadow: isExpanded ? `0 4px 16px ${green}12` : "none",
                    transition: "all 0.15s",
                  }}>
                    <button onClick={() => setExpandedInv(isExpanded ? null : inv.id)}
                      style={{ width: "100%", background: "none", border: "none",
                        cursor: "pointer", padding: "16px 18px", textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px",
                            flexWrap: "wrap", marginBottom: "4px" }}>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                              fontSize: "15px", color: "#111827" }}>{inv.clientName}</span>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: "#9ca3af" }}>{inv.id}</span>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 700, color: meta.color,
                              background: meta.bg, border: `1px solid ${meta.border}`,
                              borderRadius: "5px", padding: "1px 7px" }}>{meta.label}</span>
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#6b7280" }}>
                            {inv.items.length} item{inv.items.length !== 1 ? "s" : ""}
                            {inv.invoiceType === "week" && inv.weekLabel ? ` · Week of ${inv.weekLabel}` : ""}
                            {inv.sentAt ? ` · Sent ${new Date(inv.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                            {inv.dueDate && inv.status === "sent" ? ` · Due ${new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: "right" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                            fontWeight: 600, color: "#111827" }}>${(inv.total + (inv.gratuity || 0)).toFixed(2)}</div>
                          {inv.gratuity > 0 && (
                            <div style={{ fontSize: "12px", fontWeight: 600, color: "#C4541A",
                              background: "#FDF5EC", border: "1px solid #D4A87A",
                              borderRadius: "6px", padding: "1px 6px", marginTop: "3px", whiteSpace: "nowrap" }}>
                              +${Number(inv.gratuity).toFixed(2)} tip
                            </div>
                          )}
                          <div style={{ fontSize: "16px", color: isExpanded ? green : "#d1d5db",
                            transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</div>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div style={{ borderTop: "1px solid #f3f4f6", padding: "16px 18px" }}>
                        {/* Line items */}
                        <div style={{ background: "#f9fafb", borderRadius: "10px",
                          padding: "12px 14px", marginBottom: "14px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
                            color: "#9ca3af", marginBottom: "10px" }}>Line Items</div>
                          {inv.items.map((it, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between",
                              alignItems: "center", padding: "7px 0",
                              borderBottom: i < inv.items.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "16px", color: "#374151" }}>{it.description}</span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", fontWeight: 600, color: "#111827",
                                flexShrink: 0 }}>${it.amount}</span>
                            </div>
                          ))}
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px",
                            borderTop: "1.5px solid #e4e7ec", marginTop: "4px", paddingTop: "10px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "14px", color: "#9ca3af" }}>Walk Total</span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "14px", fontWeight: 600, color: "#111827" }}>${inv.total}</span>
                            </div>
                            {inv.gratuity > 0 && (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "14px", color: "#C4541A", fontWeight: 500 }}>Gratuity (to walker)</span>
                                <span style={{ fontFamily: "'DM Sans', sans-serif",
                                  fontSize: "14px", fontWeight: 600, color: "#C4541A" }}>+${Number(inv.gratuity).toFixed(2)}</span>
                              </div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                              borderTop: "1px solid #e4e7ec", paddingTop: "6px" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", fontWeight: 700, color: "#111827" }}>Total</span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                                fontWeight: 600, color: green }}>
                                ${(inv.total + (inv.gratuity || 0)).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {inv.notes && (
                          <div style={{ background: "#fffbeb", border: "1px solid #fde68a",
                            borderRadius: "8px", padding: "10px 12px", marginBottom: "14px",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#92400e", lineHeight: "1.5" }}>
                            📝 {inv.notes}
                          </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {inv.status !== "paid" && (
                            <button onClick={() => handleMarkPaid(clientId, inv.id)} style={{
                              padding: "8px 16px", borderRadius: "8px", border: "none",
                              background: green, color: "#fff",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 600, cursor: "pointer",
                            }}>✓ Mark as Paid</button>
                          )}
                          {inv.status === "paid" && (
                            <div style={{ padding: "8px 16px", borderRadius: "8px",
                              background: "#FDF5EC", border: "1.5px solid #EDD5A8",
                              fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 600, color: "#059669" }}>
                              ✓ Paid {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                            </div>
                          )}
                          <button onClick={() => handleVoidInvoice(clientId, inv.id)} style={{
                            padding: "8px 16px", borderRadius: "8px",
                            border: "1.5px solid #fecaca", background: "#fef2f2",
                            color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "16px", fontWeight: 600, cursor: "pointer",
                          }}>🗑 Void</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      {/* ══ CREATE VIEW ══ */}
      {view === "create" && (
        <div style={{ maxWidth: "600px" }}>

          {/* Sent confirmation */}
          {sentConfirm && (
            <div className="fade-up" style={{ background: "#FDF5EC", border: "1.5px solid #D4A87A",
              borderRadius: "16px", padding: "28px 24px", textAlign: "center", marginBottom: "20px" }}>
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>✅</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#C4541A", marginBottom: "6px" }}>Invoice Sent!</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#374151", marginBottom: "4px" }}>{sentConfirm.id}</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#6b7280", marginBottom: "20px" }}>
                Sent to <strong>{selectedClient?.name}</strong> · Due in 7 days
              </div>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={() => { resetCreate(); setView("list"); }} style={{
                  padding: "10px 20px", borderRadius: "10px", border: "1.5px solid #D4A87A",
                  background: "#fff", color: "#C4541A",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px", cursor: "pointer" }}>
                  View All Invoices
                </button>
                <button onClick={resetCreate} style={{
                  padding: "10px 20px", borderRadius: "10px", border: "none",
                  background: green, color: "#fff",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 600, cursor: "pointer" }}>
                  + New Invoice
                </button>
              </div>
            </div>
          )}

          {!sentConfirm && (
            <>
              {/* Step indicator */}
              <div style={{ display: "flex", gap: "6px", marginBottom: "24px" }}>
                {["Select Client", "Choose Walks", "Review & Send"].map((label, i) => {
                  const s = i + 1;
                  const active = step === s;
                  const done = step > s;
                  return (
                    <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column",
                      alignItems: "center", gap: "5px" }}>
                      <div style={{ width: "28px", height: "28px", borderRadius: "50%",
                        background: done ? green : active ? green : "#f3f4f6",
                        color: done || active ? "#fff" : "#9ca3af",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700,
                        border: `2px solid ${done || active ? green : "#e4e7ec"}` }}>
                        {done ? "✓" : s}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        color: active ? green : "#9ca3af", fontWeight: active ? 600 : 400,
                        textAlign: "center" }}>{label}</div>
                    </div>
                  );
                })}
              </div>

              {/* Step 1: Select client */}
              {step === 1 && (
                <div className="fade-up">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: "12px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      fontWeight: 600, color: "#374151" }}>
                      Select a client to invoice
                    </div>
                    <button onClick={() => { if (selectedClientId) setStep(2); }}
                      disabled={!selectedClientId}
                      style={{ padding: "9px 18px", borderRadius: "10px", border: "none",
                        background: selectedClientId ? green : "#e4e7ec",
                        color: selectedClientId ? "#fff" : "#9ca3af",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 600, cursor: selectedClientId ? "pointer" : "default",
                        whiteSpace: "nowrap", flexShrink: 0 }}>
                      Next: Choose Walks →
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {activeClients.length === 0 && (
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", textAlign: "center", padding: "24px" }}>
                        No active clients found.
                      </div>
                    )}
                    {[...activeClients].sort((a, b) => {
                      const countUninvoiced = c => (c.bookings || []).filter(b => {
                        if (!b.adminCompleted || b.cancelled) return false;
                        return !(c.invoices || [])
                          .filter(inv => inv.status !== "draft")
                          .flatMap(inv => inv.items.map(it => it.bookingKey))
                          .includes(b.key);
                      }).length;
                      return countUninvoiced(b) - countUninvoiced(a);
                    }).map(c => {
                      const uninvoiced = (c.bookings || []).filter(b => {
                        if (!b.adminCompleted || b.cancelled) return false;
                        const alreadyInvoiced = (c.invoices || [])
                          .filter(inv => inv.status !== "draft")
                          .flatMap(inv => inv.items.map(it => it.bookingKey))
                          .includes(b.key);
                        return !alreadyInvoiced;
                      }).length;
                      const selected = selectedClientId === c.id;
                      return (
                        <button key={c.id} onClick={() => setSelectedClientId(c.id)} style={{
                          padding: "14px 16px", borderRadius: "12px", cursor: "pointer",
                          border: selected ? `2px solid ${green}` : "1.5px solid #e4e7ec",
                          background: selected ? "#FDF5EC" : "#fff",
                          textAlign: "left", transition: "all 0.12s",
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                        }}>
                          <div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                              fontSize: "16px", color: "#111827", marginBottom: "2px" }}>{c.name}</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              color: "#9ca3af" }}>{c.email}</div>
                          </div>
                          <div style={{ flexShrink: 0, textAlign: "right" }}>
                            {uninvoiced > 0 ? (
                              <span style={{ background: "#fffbeb", border: "1px solid #fde68a",
                                borderRadius: "6px", padding: "3px 9px",
                                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 600, color: amber }}>
                                {uninvoiced} uninvoiced walk{uninvoiced !== 1 ? "s" : ""}
                              </span>
                            ) : (
                              <span style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", color: "#d1d5db" }}>all invoiced</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 2: Choose walks/week */}
              {step === 2 && selectedClient && (
                <div className="fade-up">
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
                    {selectedClient.name}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#9ca3af", marginBottom: "16px" }}>
                    {uninvoicedWalks.length} uninvoiced walk{uninvoicedWalks.length !== 1 ? "s" : ""} available
                  </div>

                  {/* Invoice type */}
                  <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
                    {[
                      { id: "walk", label: "Select Walks", icon: "🐕", desc: "Pick individual walks" },
                      { id: "week", label: "Full Week", icon: "📅", desc: "Invoice an entire week" },
                      { id: "custom", label: "Custom Charge", icon: "✏️", desc: "Any amount, any reason" },
                    ].map(opt => (
                      <button key={opt.id} onClick={() => { setInvoiceType(opt.id); setSelectedWalkKeys([]); setSelectedWeek(null); setCustomItems([{ description: "", amount: "" }]); }}
                        style={{ flex: 1, padding: "14px 12px", borderRadius: "12px", cursor: "pointer",
                          border: invoiceType === opt.id ? `2px solid ${green}` : "1.5px solid #e4e7ec",
                          background: invoiceType === opt.id ? "#FDF5EC" : "#fff",
                          textAlign: "center", transition: "all 0.12s" }}>
                        <div style={{ fontSize: "22px", marginBottom: "4px" }}>{opt.icon}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: 600, color: invoiceType === opt.id ? green : "#374151" }}>{opt.label}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                          color: "#9ca3af" }}>{opt.desc}</div>
                      </button>
                    ))}
                  </div>

                  {/* Individual walk selection */}
                  {invoiceType === "walk" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                      {uninvoicedWalks.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center",
                          justifyContent: "space-between", marginBottom: "4px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#6b7280" }}>
                            {selectedWalkKeys.length} of {uninvoicedWalks.length} selected
                          </div>
                          <button onClick={() => {
                            const allSelected = selectedWalkKeys.length === uninvoicedWalks.length;
                            setSelectedWalkKeys(allSelected ? [] : uninvoicedWalks.map(b => b.key));
                          }} style={{
                            padding: "5px 14px", borderRadius: "8px", cursor: "pointer",
                            border: `1.5px solid ${green}`,
                            background: selectedWalkKeys.length === uninvoicedWalks.length ? green : "#fff",
                            color: selectedWalkKeys.length === uninvoicedWalks.length ? "#fff" : green,
                            fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                            fontWeight: 600, transition: "all 0.15s",
                          }}>
                            {selectedWalkKeys.length === uninvoicedWalks.length ? "✓ All Selected" : "Select All"}
                          </button>
                        </div>
                      )}
                      {uninvoicedWalks.length === 0 && (
                        <div style={{ background: "#f9fafb", borderRadius: "10px",
                          padding: "20px", textAlign: "center",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                          No uninvoiced completed walks for this client.
                        </div>
                      )}
                      {uninvoicedWalks.map(b => {
                        const sel = selectedWalkKeys.includes(b.key);
                        return (
                          <button key={b.key} onClick={() => setSelectedWalkKeys(prev =>
                            sel ? prev.filter(k => k !== b.key) : [...prev, b.key]
                          )} style={{
                            padding: "12px 14px", borderRadius: "10px", cursor: "pointer",
                            border: sel ? `2px solid ${green}` : "1.5px solid #e4e7ec",
                            background: sel ? "#FDF5EC" : "#fff",
                            textAlign: "left", display: "flex",
                            alignItems: "center", justifyContent: "space-between",
                            transition: "all 0.12s",
                          }}>
                            <div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                fontSize: "15px", color: "#111827" }}>
                                {b.form?.pet || "Pet"} · {b.slot?.duration}
                              </div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                color: "#9ca3af" }}>{b.day}, {b.date}</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
                                color: sel ? green : "#111827" }}>
                                ${effectivePrice(b)}
                              </span>
                              <div style={{ width: "18px", height: "18px", borderRadius: "5px",
                                border: `2px solid ${sel ? green : "#d1d5db"}`,
                                background: sel ? green : "#fff",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                color: "#fff", fontSize: "15px", fontWeight: 700, flexShrink: 0 }}>
                                {sel ? "✓" : ""}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Week selection */}
                  {invoiceType === "week" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                      {availableWeeks.length === 0 && (
                        <div style={{ background: "#f9fafb", borderRadius: "10px",
                          padding: "20px", textAlign: "center",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                          No uninvoiced weeks available.
                        </div>
                      )}
                      {availableWeeks.map(wk => {
                        const sel = selectedWeek === wk.key;
                        const weekTotal = wk.walks.reduce((s, b) => s + effectivePrice(b), 0);
                        return (
                          <button key={wk.key} onClick={() => setSelectedWeek(sel ? null : wk.key)}
                            style={{
                              padding: "14px 16px", borderRadius: "12px", cursor: "pointer",
                              border: sel ? `2px solid ${green}` : "1.5px solid #e4e7ec",
                              background: sel ? "#FDF5EC" : "#fff", textAlign: "left",
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              transition: "all 0.12s",
                            }}>
                            <div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                fontSize: "15px", color: "#111827", marginBottom: "2px" }}>{wk.label}</div>
                              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                                color: "#9ca3af" }}>
                                {wk.walks.length} walk{wk.walks.length !== 1 ? "s" : ""}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
                                color: sel ? green : "#111827" }}>${weekTotal}</span>
                              <div style={{ width: "18px", height: "18px", borderRadius: "50%",
                                border: `2px solid ${sel ? green : "#d1d5db"}`,
                                background: sel ? green : "#fff",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                color: "#fff", fontSize: "15px", fontWeight: 700, flexShrink: 0 }}>
                                {sel ? "✓" : ""}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Custom charge line items */}
                  {invoiceType === "custom" && (
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#6b7280", marginBottom: "12px" }}>
                        Add one or more line items for this invoice.
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                        {customItems.map((item, idx) => (
                          <div key={idx} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                            <div style={{ flex: 1 }}>
                              <input
                                value={item.description}
                                onChange={e => {
                                  const updated = [...customItems];
                                  updated[idx] = { ...updated[idx], description: e.target.value };
                                  setCustomItems(updated);
                                }}
                                placeholder="Description (e.g. Holiday boarding, Special request…)"
                                style={{ width: "100%", boxSizing: "border-box", padding: "10px 13px",
                                  borderRadius: "9px", border: "1.5px solid #e4e7ec",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: "#111827", outline: "none" }}
                              />
                            </div>
                            <div style={{ width: "100px", flexShrink: 0 }}>
                              <input
                                value={item.amount}
                                onChange={e => {
                                  const updated = [...customItems];
                                  updated[idx] = { ...updated[idx], amount: e.target.value.replace(/[^0-9.]/g, "") };
                                  setCustomItems(updated);
                                }}
                                placeholder="$0.00"
                                inputMode="decimal"
                                style={{ width: "100%", boxSizing: "border-box", padding: "10px 13px",
                                  borderRadius: "9px", border: "1.5px solid #e4e7ec",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                  color: "#111827", outline: "none" }}
                              />
                            </div>
                            {customItems.length > 1 && (
                              <button onClick={() => setCustomItems(customItems.filter((_, i) => i !== idx))}
                                style={{ background: "none", border: "none", cursor: "pointer",
                                  color: "#9ca3af", fontSize: "20px", padding: "8px 4px", lineHeight: 1 }}>✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setCustomItems([...customItems, { description: "", amount: "" }])}
                        style={{ background: "none", border: `1.5px dashed ${green}`, borderRadius: "9px",
                          padding: "8px 16px", cursor: "pointer", width: "100%",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          color: green, fontWeight: 500 }}>
                        + Add Line Item
                      </button>
                      {previewItems.length > 0 && (
                        <div style={{ marginTop: "12px", background: "#FDF5EC", border: "1.5px solid #D4A87A",
                          borderRadius: "10px", padding: "12px 16px", display: "flex",
                          justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#374151" }}>
                            Total
                          </span>
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px",
                            fontWeight: 700, color: green }}>${previewTotal.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  <div style={{ marginBottom: "16px" }}>
                    <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", fontWeight: 600, color: "#9ca3af",
                      textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>
                      Notes (optional)
                    </label>
                    <textarea value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)}
                      placeholder="Any additional details or payment instructions…"
                      rows={2}
                      style={{ width: "100%", padding: "10px 13px", borderRadius: "9px",
                        border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "15px", color: "#111827", resize: "vertical",
                        outline: "none", boxSizing: "border-box" }} />
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => setStep(1)} style={{
                      padding: "12px 20px", borderRadius: "11px",
                      border: "1.5px solid #e4e7ec", background: "#fff",
                      color: "#374151", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", cursor: "pointer" }}>← Back</button>
                    <button onClick={() => { if (previewItems.length > 0) setStep(3); }}
                      disabled={previewItems.length === 0}
                      style={{ flex: 1, padding: "12px", borderRadius: "11px", border: "none",
                        background: previewItems.length > 0 ? green : "#e4e7ec",
                        color: previewItems.length > 0 ? "#fff" : "#9ca3af",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        fontWeight: 600, cursor: previewItems.length > 0 ? "pointer" : "default" }}>
                      Preview Invoice →
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Preview & Send */}
              {step === 3 && selectedClient && (
                <div className="fade-up">
                  {/* Invoice preview card */}
                  <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                    borderRadius: "16px", overflow: "hidden", marginBottom: "16px",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}>

                    {/* Invoice header */}
                    <div style={{ background: "#4D2E10", padding: "20px 22px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between",
                        alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                            fontWeight: 600, color: "#fff", marginBottom: "2px" }}>Lonestar Bark Co.</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#ffffff99" }}>Dallas, TX · lonestarbark.com</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 700, color: "#d97706", textTransform: "uppercase",
                            letterSpacing: "1px" }}>Invoice</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#ffffff99", marginTop: "2px" }}>#{generateInvoiceId().slice(-8)}</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ padding: "20px 22px" }}>
                      {/* Bill to */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
                        gap: "16px", marginBottom: "20px" }}>
                        <div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#9ca3af", textTransform: "uppercase",
                            letterSpacing: "1.5px", marginBottom: "6px" }}>Bill To</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 600, color: "#111827" }}>{selectedClient.name}</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            color: "#6b7280" }}>{selectedClient.email}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#9ca3af", textTransform: "uppercase",
                            letterSpacing: "1.5px", marginBottom: "6px" }}>Due Date</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 600, color: "#111827" }}>
                            {new Date(getInvoiceDueDate(new Date())).toLocaleDateString("en-US", {
                              month: "long", day: "numeric", year: "numeric" })}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            color: "#9ca3af" }}>Net 7 days</div>
                        </div>
                      </div>

                      {/* Line items */}
                      <div style={{ borderTop: "1.5px solid #f3f4f6", paddingTop: "14px" }}>
                        <div style={{ display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: "0 12px" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#9ca3af", textTransform: "uppercase",
                            letterSpacing: "1.5px", paddingBottom: "8px" }}>Description</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#9ca3af", textTransform: "uppercase",
                            letterSpacing: "1.5px", paddingBottom: "8px", textAlign: "right" }}>Amount</div>
                          {previewItems.map((it, i) => (
                            <>
                              <div key={`d${i}`} style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", color: "#374151", paddingBottom: "8px",
                                borderBottom: i < previewItems.length - 1 ? "1px solid #f9fafb" : "none" }}>
                                {it.description}
                              </div>
                              <div key={`a${i}`} style={{ fontFamily: "'DM Sans', sans-serif",
                                fontSize: "15px", fontWeight: 600, color: "#111827",
                                paddingBottom: "8px", textAlign: "right",
                                borderBottom: i < previewItems.length - 1 ? "1px solid #f9fafb" : "none" }}>
                                ${it.amount}
                              </div>
                            </>
                          ))}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "center", borderTop: "1.5px solid #e4e7ec",
                          paddingTop: "12px", marginTop: "4px" }}>
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: 700, color: "#111827" }}>Total Due</span>
                          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                            fontWeight: 600, color: green }}>${previewTotal}</span>
                        </div>
                      </div>

                      {invoiceNotes && (
                        <div style={{ background: "#f9fafb", borderRadius: "8px",
                          padding: "10px 12px", marginTop: "14px",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#6b7280", lineHeight: "1.5" }}>
                          📝 {invoiceNotes}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => setStep(2)} style={{
                      padding: "12px 20px", borderRadius: "11px",
                      border: "1.5px solid #e4e7ec", background: "#fff",
                      color: "#374151", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "15px", cursor: "pointer" }}>← Edit</button>
                    <button onClick={handleSendInvoice} disabled={sending} style={{
                      flex: 1, padding: "13px", borderRadius: "11px", border: "none",
                      background: sending ? "#9ca3af" : green,
                      color: "#fff", fontFamily: "'DM Sans', sans-serif",
                      fontSize: "16px", fontWeight: 600,
                      cursor: sending ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    }}>
                      {sending ? (
                        <>
                          <span style={{ display: "inline-block", width: "14px", height: "14px",
                            border: "2px solid #ffffff66", borderTop: "2px solid #fff",
                            borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                          Sending…
                        </>
                      ) : "📤 Send Invoice to Client"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}


export default AdminInvoicesTab;
