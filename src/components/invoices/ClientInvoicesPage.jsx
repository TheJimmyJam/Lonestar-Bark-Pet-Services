import { useState } from "react";
import { saveClients, updateInvoiceInDB } from "../../supabase.js";
import { fmt } from "../../helpers.js";
import { invoiceStatusMeta } from "./invoiceHelpers.js";
import StripePaymentModal from "./StripePaymentModal.jsx";

// ─── Client Invoices Page ──────────────────────────────────────────────────────
// Two sections:
//   1. Stripe Receipts  — confirmed bookings with stripeSessionId (paid at booking)
//   2. Admin Invoices   — invoices created by admin post-walk (outstanding or paid)
// ──────────────────────────────────────────────────────────────────────────────
// ── Export helpers ────────────────────────────────────────────────────────────

function exportCSV(client, allPaid) {
  const rows = [
    ["Date", "Day", "Service", "Time", "Duration", "Walker", "Pet", "Amount Paid", "Paid On"],
  ];
  allPaid.forEach(item => {
    if (item._type === "stripe") {
      const svc = item.service === "dog" ? "Dog Walk" : item.service === "cat" ? "Cat Visit" : "Meet & Greet";
      const paidOn = item.paidAt ? new Date(item.paidAt).toLocaleDateString("en-US") : "";
      rows.push([
        item.date || "", item.day || "", svc,
        item.slot?.time || "", item.slot?.duration || "",
        item.form?.walker || "", item.form?.pet || "",
        `$${(item.price || 0).toFixed(2)}`, paidOn,
      ]);
    } else {
      // Admin invoice
      const paidOn = item.paidAt ? new Date(item.paidAt).toLocaleDateString("en-US") : "";
      (item.items || []).forEach(it => {
        rows.push([
          "", "", it.description || "",
          "", "", "", "",
          `$${it.amount || 0}`, paidOn,
        ]);
      });
    }
  });

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `LonestarBark_${client.name?.replace(/\s+/g, "_") || "receipts"}_${new Date().getFullYear()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF(client, allPaid) {
  const year = new Date().getFullYear();
  const total = allPaid.reduce((sum, item) => {
    if (item._type === "stripe") return sum + (item.price || 0);
    return sum + (item.total || 0) + (item.gratuity || 0);
  }, 0);

  const rows = allPaid.map(item => {
    if (item._type === "stripe") {
      const svc = item.service === "dog" ? "Dog Walk" : item.service === "cat" ? "Cat Visit" : "Meet & Greet";
      const paidOn = item.paidAt ? new Date(item.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
      return `
        <tr>
          <td>${item.day || ""}, ${item.date || ""}</td>
          <td>${svc}</td>
          <td>${item.slot?.time || "—"}</td>
          <td>${item.slot?.duration || "—"}</td>
          <td>${item.form?.walker || "—"}</td>
          <td>${item.form?.pet || "—"}</td>
          <td class="amount">$${(item.price || 0).toFixed(2)}</td>
          <td>${paidOn}</td>
        </tr>`;
    } else {
      const paidOn = item.paidAt ? new Date(item.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
      const desc = item.type === "week" && item.weekLabel ? `Week of ${item.weekLabel}` : `${(item.items || []).length} walk(s)`;
      return `
        <tr>
          <td colspan="2">${desc}</td>
          <td colspan="4" style="color:#6b7280;font-size:13px;">${(item.items || []).map(i => i.description).join("; ")}</td>
          <td class="amount">$${((item.total || 0) + (item.gratuity || 0)).toFixed(2)}</td>
          <td>${paidOn}</td>
        </tr>`;
    }
  }).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Lonestar Bark Co. — Walk History</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', Helvetica, Arial, sans-serif; color: #111827; background: #fff; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #0B1423; }
  .brand { font-size: 20px; font-weight: 700; color: #0B1423; letter-spacing: 1px; text-transform: uppercase; }
  .brand-sub { font-size: 12px; color: #9B7444; letter-spacing: 2px; text-transform: uppercase; margin-top: 4px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 22px; font-weight: 700; color: #111827; }
  .doc-title p { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .client-block { background: #f9fafb; border-radius: 10px; padding: 16px 20px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: center; }
  .client-block .name { font-size: 16px; font-weight: 600; }
  .client-block .email { font-size: 13px; color: #6b7280; margin-top: 2px; }
  .tax-note { font-size: 13px; color: #059669; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
  thead tr { background: #0B1423; color: #fff; }
  thead th { padding: 10px 12px; text-align: left; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  thead th.amount { text-align: right; }
  tbody tr { border-bottom: 1px solid #f3f4f6; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  td { padding: 10px 12px; vertical-align: top; }
  td.amount { text-align: right; font-weight: 600; color: #059669; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 32px; }
  .totals-box { background: #0B1423; color: #fff; border-radius: 10px; padding: 16px 24px; min-width: 220px; }
  .totals-box .label { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 6px; }
  .totals-box .value { font-size: 26px; font-weight: 700; color: #fff; }
  .totals-box .sub { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .footer { border-top: 1px solid #e4e7ec; padding-top: 16px; font-size: 12px; color: #9ca3af; display: flex; justify-content: space-between; }
  @media print {
    body { padding: 20px; }
    button { display: none; }
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">🐾 Lonestar Bark Co.</div>
      <div class="brand-sub">Dallas, TX Dog Walking</div>
    </div>
    <div class="doc-title">
      <h1>Walk History & Receipts</h1>
      <p>Tax Year ${year} &nbsp;·&nbsp; Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
    </div>
  </div>

  <div class="client-block">
    <div>
      <div class="name">${client.name || ""}</div>
      <div class="email">${client.email || ""}</div>
    </div>
    <div class="tax-note">✓ For tax/expense documentation</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Service</th>
        <th>Time</th>
        <th>Duration</th>
        <th>Walker</th>
        <th>Pet</th>
        <th class="amount">Amount</th>
        <th>Paid On</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:24px;">No paid records found.</td></tr>'}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="label">Total Paid — ${year}</div>
      <div class="value">$${total.toFixed(2)}</div>
      <div class="sub">${allPaid.length} transaction${allPaid.length !== 1 ? "s" : ""}</div>
    </div>
  </div>

  <div class="footer">
    <span>Lonestar Bark Co. &nbsp;·&nbsp; hello@lonestarbarkco.com &nbsp;·&nbsp; Dallas, TX</span>
    <span>This document may be used for pet care expense documentation.</span>
  </div>

  <script>window.onload = () => window.print();</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}

// ─── Client Invoices Page ──────────────────────────────────────────────────────
function ClientInvoicesPage({ client, clients, setClients }) {
  const [selectedInv, setSelectedInv] = useState(null);
  const [payingInv, setPayingInv] = useState(null);
  const [paidConfirm, setPaidConfirm] = useState(null);
  const [activeTab, setActiveTab] = useState("paid");

  const orange = "#C4541A";

  // ── Stripe receipts: confirmed bookings paid at booking time ─────────────
  const stripeReceipts = (client.bookings || [])
    .filter(b => b.stripeSessionId && b.paidAt)
    .map(b => ({ ...b, _type: "stripe" }));

  // ── Admin invoices ────────────────────────────────────────────────────────
  const adminInvoices = [...(client.invoices || [])];
  const outstandingInvoices = adminInvoices.filter(inv => {
    const { effectiveStatus } = invoiceStatusMeta(inv.status, inv.dueDate);
    return effectiveStatus === "sent" || effectiveStatus === "overdue";
  });
  const paidAdminInvoices = adminInvoices
    .filter(inv => {
      const { effectiveStatus } = invoiceStatusMeta(inv.status, inv.dueDate);
      return effectiveStatus === "paid";
    })
    .map(inv => ({ ...inv, _type: "admin" }));

  // ── Combined "Paid" list: Stripe bookings + paid admin invoices ───────────
  const allPaid = [...stripeReceipts, ...paidAdminInvoices]
    .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));

  // ── Refunds: cancelled paid bookings ─────────────────────────────────────
  const cancelledPaidBookings = (client.bookings || [])
    .filter(b => b.cancelled && b.stripeSessionId && b.paidAt)
    .sort((a, b) => new Date(b.cancelledAt || 0) - new Date(a.cancelledAt || 0));

  const outstandingTotal = outstandingInvoices.reduce((s, inv) => s + (inv.total || 0), 0);

  const handlePaymentSuccess = (inv) => {
    const now = new Date().toISOString();
    const updatedClient = {
      ...client,
      invoices: (client.invoices || []).map(i =>
        i.id === inv.id ? { ...i, status: "paid", paidAt: now } : i
      ),
    };
    const clientPinKey = client.pin
      || Object.keys(clients).find(k => clients[k]?.id === client.id)
      || String(client.id);
    const updatedClients = { ...clients, [clientPinKey]: updatedClient };
    setClients(updatedClients);
    saveClients(updatedClients);
    updateInvoiceInDB(inv.id, { status: "paid", paidAt: now });
    setPayingInv(null);
    setPaidConfirm(inv.id);
    setSelectedInv(null);
    setTimeout(() => setPaidConfirm(null), 5000);
  };

  const svcLabel = (b) => {
    if (b.service === "dog") return "Dog Walk";
    if (b.service === "cat") return "Cat Visit";
    return "Meet & Greet";
  };

  const tabs = [
    { key: "paid", label: "Paid", count: allPaid.length },
    { key: "outstanding", label: "Outstanding", count: outstandingInvoices.length },
    { key: "refunds", label: "Refunds", count: cancelledPaidBookings.length },
  ];

  return (
    <div className="app-container fade-up">

      {payingInv && (
        <StripePaymentModal
          invoice={payingInv}
          client={client}
          onClose={() => setPayingInv(null)}
          onPaid={() => handlePaymentSuccess(payingInv)}
        />
      )}

      {/* Header */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase",
              letterSpacing: "1.5px", fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
              My Invoices
            </div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
              Paid receipts from Stripe bookings and any outstanding invoices from Lonestar Bark Co.
            </p>
          </div>
          {allPaid.length > 0 && (
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              <button onClick={() => exportCSV(client, allPaid)}
                title="Download CSV for spreadsheet / accounting software"
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
                  borderRadius: "10px", border: "1.5px solid #e4e7ec", background: "#fff",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600,
                  color: "#374151", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = orange; e.currentTarget.style.color = orange; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e4e7ec"; e.currentTarget.style.color = "#374151"; }}>
                ↓ CSV
              </button>
              <button onClick={() => exportPDF(client, allPaid)}
                title="Open print-ready PDF — choose 'Save as PDF' in print dialog"
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
                  borderRadius: "10px", border: "1.5px solid #e4e7ec", background: "#fff",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600,
                  color: "#374151", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = orange; e.currentTarget.style.color = orange; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e4e7ec"; e.currentTarget.style.color = "#374151"; }}>
                ↓ PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "18px", flexWrap: "wrap" }}>
        {tabs.map(tab => (
          <button key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSelectedInv(null); }}
            style={{
              padding: "8px 16px", borderRadius: "20px", border: "1.5px solid",
              borderColor: activeTab === tab.key ? orange : "#e4e7ec",
              background: activeTab === tab.key ? orange : "#fff",
              color: activeTab === tab.key ? "#fff" : "#6b7280",
              fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
              transition: "all 0.15s",
            }}>
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                background: activeTab === tab.key ? "rgba(255,255,255,0.25)" : "#f3f4f6",
                color: activeTab === tab.key ? "#fff" : "#374151",
                borderRadius: "10px", padding: "1px 7px", fontSize: "12px", fontWeight: 700,
              }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Paid confirm banner */}
      {paidConfirm && (
        <div className="fade-up" style={{ background: "#FDF5EC", border: "1.5px solid #D4A87A",
          borderRadius: "12px", padding: "14px 18px", marginBottom: "16px",
          display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "20px" }}>✅</span>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#C4541A", fontWeight: 500 }}>
            Payment received! Your invoice has been marked as paid.
          </div>
        </div>
      )}

      {/* ── PAID (Stripe bookings + paid admin invoices) ──────────────── */}
      {activeTab === "paid" && (
        <>
          {allPaid.length === 0 ? (
            <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px",
              padding: "48px 24px", textAlign: "center" }}>
              <div style={{ fontSize: "40px", marginBottom: "14px" }}>🧾</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
                color: "#111827", marginBottom: "8px" }}>No paid receipts yet</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                Paid bookings and invoices will show here.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {allPaid.map(item => {
                if (item._type === "stripe") {
                  const b = item;
                  const isExpanded = selectedInv === b.key;
                  return (
                    <div key={b.key} style={{
                      background: "#fff",
                      border: isExpanded ? `2px solid ${orange}` : "1.5px solid #d1fae5",
                      borderRadius: "16px", overflow: "hidden", transition: "all 0.15s",
                      boxShadow: isExpanded ? `0 4px 16px ${orange}12` : "none",
                    }}>
                      <button onClick={() => setSelectedInv(isExpanded ? null : b.key)}
                        style={{ width: "100%", background: "none", border: "none",
                          cursor: "pointer", padding: "16px 18px", textAlign: "left" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px",
                              flexWrap: "wrap", marginBottom: "4px" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 600, color: "#111827" }}>
                                {svcLabel(b)} — {b.day}, {b.date}
                              </span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                                fontWeight: 700, color: "#059669", background: "#d1fae5",
                                border: "1px solid #a7f3d0", borderRadius: "5px", padding: "1px 7px" }}>
                                PAID
                              </span>
                            </div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                              {b.slot?.time || "—"} · {b.slot?.duration || "—"}
                              {b.form?.walker ? ` · ${b.form.walker}` : ""}
                              {b.paidAt ? ` · Paid ${new Date(b.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0, textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                              fontWeight: 700, color: "#059669" }}>
                              ${(b.price || 0).toFixed(2)}
                            </div>
                            <div style={{ fontSize: "16px", color: isExpanded ? orange : "#d1d5db",
                              transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</div>
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        <div style={{ borderTop: "1px solid #f3f4f6", padding: "16px 18px" }}>
                          <div style={{ background: "#f9fafb", borderRadius: "10px", padding: "12px 14px", marginBottom: "12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between",
                              padding: "6px 0", borderBottom: "1px solid #e4e7ec" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#374151" }}>
                                {svcLabel(b)} — {b.day}, {b.date} at {b.slot?.time || "—"} ({b.slot?.duration || "—"})
                                {b.form?.pet ? ` — ${b.form.pet}` : ""}
                              </span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                                fontWeight: 600, color: "#111827", flexShrink: 0, marginLeft: "12px" }}>
                                ${(b.price || 0).toFixed(2)}
                              </span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between",
                              alignItems: "center", paddingTop: "10px" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 700, color: "#111827" }}>Total Paid</span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 700, color: "#059669" }}>${(b.price || 0).toFixed(2)}</span>
                            </div>
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                            color: "#9ca3af", textAlign: "center" }}>
                            💳 Paid via Stripe · Session {b.stripeSessionId?.slice(0, 18)}…
                          </div>
                          <div style={{ textAlign: "center", padding: "12px",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                            color: "#059669", fontWeight: 600, marginTop: "4px" }}>
                            ✅ Thank you — you're all set!
                          </div>
                        </div>
                      )}
                    </div>
                  );
                } else {
                  // Admin invoice (paid)
                  const inv = item;
                  return <InvoiceCard key={inv.id} inv={inv} selectedInv={selectedInv}
                    setSelectedInv={setSelectedInv} setPayingInv={setPayingInv} orange={orange} />;
                }
              })}
            </div>
          )}
        </>
      )}

      {/* ── REFUNDS ───────────────────────────────────────────────────── */}
      {activeTab === "refunds" && (
        <>
          {cancelledPaidBookings.length === 0 ? (
            <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px",
              padding: "48px 24px", textAlign: "center" }}>
              <div style={{ fontSize: "40px", marginBottom: "14px" }}>💸</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
                color: "#111827", marginBottom: "8px" }}>No cancellations</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                Cancelled bookings and any refunds will appear here.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {/* Refund policy reminder */}
              <div style={{ background: "#f9fafb", border: "1.5px solid #e4e7ec", borderRadius: "12px",
                padding: "12px 16px", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#6b7280" }}>
                📋 <strong style={{ color: "#374151" }}>Refund policy:</strong> 24h+ → full refund · 12–24h → 50% refund · under 12h → no refund
              </div>

              {cancelledPaidBookings.map(b => {
                const hasRefund = b.refundAmount > 0;
                const noRefund = !hasRefund;
                const isPartial = hasRefund && b.refundPercent < 1;
                const isExpanded = selectedInv === b.key + "_refund";

                const statusLabel = hasRefund
                  ? (isPartial ? "50% REFUND" : "REFUNDED")
                  : "NO REFUND";
                const statusColor = hasRefund ? "#2563eb" : "#9ca3af";
                const statusBg   = hasRefund ? "#eff6ff" : "#f9fafb";
                const statusBorder = hasRefund ? "#bfdbfe" : "#e4e7ec";

                const cancelDate = b.cancelledAt
                  ? new Date(b.cancelledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—";

                return (
                  <div key={b.key} style={{
                    background: "#fff",
                    border: isExpanded ? `2px solid ${orange}` : `1.5px solid ${hasRefund ? "#bfdbfe" : "#e4e7ec"}`,
                    borderRadius: "16px", overflow: "hidden", transition: "all 0.15s",
                    boxShadow: isExpanded ? `0 4px 16px ${orange}12` : "none",
                  }}>
                    <button onClick={() => setSelectedInv(isExpanded ? null : b.key + "_refund")}
                      style={{ width: "100%", background: "none", border: "none",
                        cursor: "pointer", padding: "16px 18px", textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                              fontWeight: 600, color: "#111827" }}>
                              {svcLabel(b)} — {b.day}, {b.date}
                            </span>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                              fontWeight: 700, color: statusColor, background: statusBg,
                              border: `1px solid ${statusBorder}`, borderRadius: "5px", padding: "1px 7px" }}>
                              {statusLabel}
                            </span>
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                            {b.slot?.time || "—"} · {b.slot?.duration || "—"}
                            {b.form?.walker ? ` · ${b.form.walker}` : ""}
                            {` · Cancelled ${cancelDate}`}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: "right" }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                            fontWeight: 700, color: hasRefund ? "#2563eb" : "#9ca3af" }}>
                            {hasRefund ? `−$${b.refundAmount.toFixed(2)}` : "$0.00"}
                          </div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                            color: "#9ca3af", textDecoration: "line-through" }}>
                            ${(b.price || 0).toFixed(2)}
                          </div>
                          <div style={{ fontSize: "16px", color: isExpanded ? orange : "#d1d5db",
                            transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</div>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div style={{ borderTop: "1px solid #f3f4f6", padding: "16px 18px" }}>
                        <div style={{ background: "#f9fafb", borderRadius: "10px", padding: "12px 14px", marginBottom: "12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between",
                            padding: "6px 0", borderBottom: "1px solid #e4e7ec" }}>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#374151" }}>
                              {svcLabel(b)} — {b.day}, {b.date} at {b.slot?.time || "—"}
                            </span>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                              fontWeight: 600, color: "#6b7280", flexShrink: 0, marginLeft: "12px",
                              textDecoration: "line-through" }}>
                              ${(b.price || 0).toFixed(2)}
                            </span>
                          </div>
                          {hasRefund ? (
                            <div style={{ display: "flex", justifyContent: "space-between",
                              alignItems: "center", paddingTop: "10px" }}>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 700, color: "#111827" }}>
                                Refund {isPartial ? "(50%)" : "(100%)"}
                              </span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                                fontWeight: 700, color: "#2563eb" }}>
                                ${b.refundAmount.toFixed(2)}
                              </span>
                            </div>
                          ) : (
                            <div style={{ paddingTop: "10px", fontFamily: "'DM Sans', sans-serif",
                              fontSize: "14px", color: "#9ca3af" }}>
                              Cancelled within 12 hours — no refund per policy.
                            </div>
                          )}
                        </div>
                        {b.refundedAt && (
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                            color: "#9ca3af", textAlign: "center" }}>
                            💳 Refund issued {new Date(b.refundedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            {b.refundId ? ` · ${b.refundId.slice(0, 14)}…` : ""}
                          </div>
                        )}
                        {!hasRefund && (
                          <div style={{ textAlign: "center", fontFamily: "'DM Sans', sans-serif",
                            fontSize: "14px", color: "#9ca3af", paddingTop: "8px" }}>
                            Questions? Email <a href="mailto:hello@lonestarbarkco.com"
                              style={{ color: orange, textDecoration: "none" }}>hello@lonestarbarkco.com</a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── OUTSTANDING ADMIN INVOICES ─────────────────────────────────── */}
      {activeTab === "outstanding" && (
        <>
          {outstandingTotal > 0 && (
            <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a",
              borderRadius: "14px", padding: "18px 20px", marginBottom: "20px",
              display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                  fontWeight: 700, color: "#b45309", textTransform: "uppercase",
                  letterSpacing: "1px", marginBottom: "4px" }}>Outstanding Balance</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "22px",
                  fontWeight: 700, color: "#111827" }}>${outstandingTotal.toFixed(2)}</div>
              </div>
              <div style={{ fontSize: "28px" }}>🧾</div>
            </div>
          )}

          {outstandingInvoices.length === 0 ? (
            <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "16px",
              padding: "48px 24px", textAlign: "center" }}>
              <div style={{ fontSize: "40px", marginBottom: "14px" }}>✅</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
                color: "#111827", marginBottom: "8px" }}>You're all caught up</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
                No outstanding invoices — nothing due.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {outstandingInvoices.map(inv => <InvoiceCard key={inv.id} inv={inv} selectedInv={selectedInv}
                setSelectedInv={setSelectedInv} setPayingInv={setPayingInv} orange={orange} />)}
            </div>
          )}
        </>
      )}

    </div>
  );
}

// ─── Shared Invoice Card (for admin-created invoices) ─────────────────────────
function InvoiceCard({ inv, selectedInv, setSelectedInv, setPayingInv, orange }) {
  const meta = invoiceStatusMeta(inv.status, inv.dueDate);
  const isExpanded = selectedInv === inv.id;
  const isPending = meta.effectiveStatus === "sent" || meta.effectiveStatus === "overdue";

  return (
    <div style={{
      background: "#fff",
      border: isExpanded ? `2px solid ${orange}` : `1.5px solid ${isPending ? "#fde68a" : "#e4e7ec"}`,
      borderRadius: "16px", overflow: "hidden",
      boxShadow: isExpanded ? `0 4px 16px ${orange}12` : "none",
      transition: "all 0.15s",
    }}>
      <button onClick={() => setSelectedInv(isExpanded ? null : inv.id)}
        style={{ width: "100%", background: "none", border: "none",
          cursor: "pointer", padding: "16px 18px", textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                fontWeight: 600, color: "#111827" }}>
                {inv.type === "week" && inv.weekLabel ? `Week of ${inv.weekLabel}` : `${(inv.items||[]).length} walk${(inv.items||[]).length !== 1 ? "s" : ""}`}
              </span>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700,
                color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`,
                borderRadius: "5px", padding: "1px 7px" }}>{meta.label}</span>
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
              {inv.id}
              {inv.dueDate && inv.status === "sent"
                ? ` · Due ${new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : ""}
              {inv.paidAt
                ? ` · Paid ${new Date(inv.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : ""}
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: "right" }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700,
              color: meta.effectiveStatus === "paid" ? "#059669" : "#111827" }}>
              ${(inv.total + (inv.gratuity || 0)).toFixed(2)}
            </div>
            <div style={{ fontSize: "16px", color: isExpanded ? orange : "#d1d5db",
              transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</div>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div style={{ borderTop: "1px solid #f3f4f6", padding: "16px 18px" }}>
          <div style={{ background: "#f9fafb", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px" }}>
            {(inv.items || []).map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", padding: "7px 0",
                borderBottom: i < (inv.items.length - 1) ? "1px solid #f3f4f6" : "none" }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#374151" }}>{it.description}</span>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600,
                  color: "#111827", flexShrink: 0, marginLeft: "12px" }}>${it.amount}</span>
              </div>
            ))}
            <div style={{ borderTop: "1.5px solid #e4e7ec", marginTop: "4px", paddingTop: "10px",
              display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>Walk Total</span>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                  fontWeight: 600, color: "#111827" }}>${inv.total}</span>
              </div>
              {inv.gratuity > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#C4541A", fontWeight: 500 }}>Gratuity</span>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#C4541A" }}>
                    +${Number(inv.gratuity).toFixed(2)}
                  </span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                borderTop: "1px solid #e4e7ec", paddingTop: "6px", marginTop: "2px" }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "#111827" }}>Total</span>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700,
                  color: meta.effectiveStatus === "paid" ? "#059669" : orange }}>
                  ${(inv.total + (inv.gratuity || 0)).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          {inv.notes && (
            <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "10px 12px", marginBottom: "14px",
              fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280", lineHeight: "1.5" }}>
              📝 {inv.notes}
            </div>
          )}
          {isPending && (
            <button onClick={() => setPayingInv(inv)} style={{
              width: "100%", padding: "13px", borderRadius: "11px", border: "none",
              background: orange, color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            }}>
              💳 Pay ${inv.total} Now
            </button>
          )}
          {meta.effectiveStatus === "paid" && (
            <div style={{ textAlign: "center", padding: "10px", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", color: "#059669", fontWeight: 600 }}>
              ✅ This invoice has been paid. Thank you!
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ClientInvoicesPage;
