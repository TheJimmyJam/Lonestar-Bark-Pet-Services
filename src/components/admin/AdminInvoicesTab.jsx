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

  return (
    <div className="fade-up">
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
            fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Financials</div>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
            Stripe collections, refunds, gratuities, and invoices.
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
          {/* KPI grid — auto-reflows from 3 cols on desktop to 2 on tablet to 1 on narrow phones */}
          {(() => {
            const kpiCard = (kpi) => (
              <div key={kpi.label} style={{ background: kpi.bg, border: `1.5px solid ${kpi.border}`,
                borderRadius: "14px", padding: "16px 18px",
                minWidth: 0, overflow: "hidden" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                  fontWeight: 700, color: kpi.color, textTransform: "uppercase",
                  letterSpacing: "1px", marginBottom: "6px",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kpi.label}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                  fontWeight: 700, color: "#111827", lineHeight: 1,
                  overflowWrap: "anywhere" }}>{kpi.value}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                  color: "#6b7280", marginTop: "3px",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kpi.sub}</div>
              </div>
            );
            const kpis = [
              { label: "Weekly Charges",   value: fmt(stripeTotalWeek, true),  sub: `${stripeCountWeek} Stripe payment${stripeCountWeek !== 1 ? "s" : ""} this week`,           color: green,      bg: "#FDF5EC", border: "#D4A843" },
              { label: "Total Charges",    value: fmt(stripeTotal, true),       sub: `${stripeReceiptsAll.length} Stripe payment${stripeReceiptsAll.length !== 1 ? "s" : ""} lifetime`, color: "#059669",  bg: "#f0fdf4", border: "#a8d5bf" },
              { label: "Gratuities Owed",  value: gratuityOwed > 0 ? fmt(gratuityOwed, true) : "—",           sub: "unpaid to walkers",     color: "#b45309",  bg: "#fffbeb", border: "#fde68a" },
              { label: "Gratuities Paid",  value: gratuitiesPaidLifetime > 0 ? fmt(gratuitiesPaidLifetime, true) : "—", sub: "lifetime disbursed", color: "#7A4D6E",  bg: "#F7F0F5", border: "#D8ABCF" },
              { label: "Refunds This Week", value: refundsThisWeek > 0 ? fmt(refundsThisWeek, true) : "—",     sub: `${refundCountWeek} refund${refundCountWeek !== 1 ? "s" : ""} issued`,             color: "#dc2626",  bg: "#fef2f2", border: "#fecaca" },
              { label: "Refunds Lifetime", value: refundsLifetime > 0 ? fmt(refundsLifetime, true) : "—",      sub: `${refundCountLifetime} total refund${refundCountLifetime !== 1 ? "s" : ""}`,      color: "#9ca3af",  bg: "#f9fafb", border: "#e4e7ec" },
            ];
            return (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "10px", marginBottom: "20px",
              }}>
                {kpis.map(kpiCard)}
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

          {/* Stripe payments list */}
          {filterStatus === "stripe" && (
            stripeReceiptsAll.length === 0 ? (
              <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "16px", padding: "40px", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "12px" }}>💳</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                  fontWeight: 600, color: "#374151", marginBottom: "4px" }}>No Stripe payments yet</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
                  Payments made at booking time will appear here.
                </div>
              </div>
            ) : (
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
            )
          )}

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
