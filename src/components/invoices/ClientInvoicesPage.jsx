import { useState, useEffect, useMemo } from "react";
import { saveClients, updateInvoiceInDB } from "../../supabase.js";
import { fmt, firstName } from "../../helpers.js";
import { invoiceStatusMeta, getInvoiceDueDate } from "./invoiceHelpers.js";
import StripePaymentModal from "./StripePaymentModal.jsx";
import Header from "../shared/Header.jsx";

// ─── Client Invoices Page ──────────────────────────────────────────────────────
function ClientInvoicesPage({ client, clients, setClients }) {
  const [selectedInv, setSelectedInv] = useState(null);
  const [payingInv, setPayingInv] = useState(null);
  const [paidConfirm, setPaidConfirm] = useState(null);
  const [invSearch, setInvSearch] = useState("");

  const green = "#C4541A";
  const allInvoices = [...(client.invoices || [])].sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
  const invQ = invSearch.toLowerCase();
  const myInvoices = invQ
    ? allInvoices.filter(inv =>
        (inv.id || "").toLowerCase().includes(invQ) ||
        (inv.status || "").toLowerCase().includes(invQ) ||
        String(inv.total || "").includes(invQ) ||
        (inv.weekLabel || "").toLowerCase().includes(invQ) ||
        (inv.items || []).some(it => (it.description || "").toLowerCase().includes(invQ))
      )
    : allInvoices;

  const outstandingTotal = myInvoices
    .filter(inv => inv.status === "sent")
    .reduce((s, inv) => s + (inv.total || 0), 0);

  const handlePaymentSuccess = (inv) => {
    const now = new Date().toISOString();
    const updatedClient = {
      ...client,
      invoices: (client.invoices || []).map(i =>
        i.id === inv.id ? { ...i, status: "paid", paidAt: now } : i
      ),
    };
    const updatedClients = { ...clients, [client.id]: updatedClient };
    setClients(updatedClients);
    saveClients(updatedClients);
    // Update in dedicated invoices table
    updateInvoiceInDB(inv.id, { status: "paid", paidAt: now });
    setPayingInv(null);
    setPaidConfirm(inv.id);
    setSelectedInv(null);
    setTimeout(() => setPaidConfirm(null), 5000);
  };

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
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
          fontWeight: 600, color: "#111827", marginBottom: "4px" }}>My Invoices</div>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
          View your paid receipts and any outstanding invoices from Lonestar Bark Co.
        </p>
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: "20px" }}>
        <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)",
          fontSize: "16px", pointerEvents: "none" }}>🔍</span>
        <input
          value={invSearch}
          onChange={e => setInvSearch(e.target.value)}
          placeholder="Search by invoice ID, status, amount…"
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px",
            borderRadius: "10px", border: "1.5px solid #e4e7ec", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", color: "#111827", background: "#fff", outline: "none" }}
        />
        {invSearch && (
          <button onClick={() => setInvSearch("")} style={{ position: "absolute", right: "10px",
            top: "50%", transform: "translateY(-50%)", background: "none", border: "none",
            cursor: "pointer", color: "#9ca3af", fontSize: "16px" }}>✕</button>
        )}
      </div>

      {/* Paid confirm banner */}
      {paidConfirm && (
        <div className="fade-up" style={{ background: "#FDF5EC", border: "1.5px solid #D4A87A",
          borderRadius: "12px", padding: "14px 18px", marginBottom: "16px",
          display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "20px" }}>✅</span>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            color: "#C4541A", fontWeight: 500 }}>
            Payment received! Your invoice has been marked as paid.
          </div>
        </div>
      )}

      {/* Outstanding balance */}
      {outstandingTotal > 0 && (
        <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a",
          borderRadius: "14px", padding: "18px 20px", marginBottom: "20px",
          display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              fontWeight: 700, color: "#b45309", textTransform: "uppercase",
              letterSpacing: "1px", marginBottom: "4px" }}>Outstanding Balance</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827" }}>${outstandingTotal}</div>
          </div>
          <div style={{ fontSize: "28px" }}>🧾</div>
        </div>
      )}

      {/* Empty state */}
      {myInvoices.length === 0 && (
        <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
          borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "40px", marginBottom: "14px" }}>🧾</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
            fontWeight: 600, color: "#111827", marginBottom: "8px" }}>No invoices yet</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
            Your paid receipts and invoices will show up here.
          </div>
        </div>
      )}

      {/* Invoice list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {myInvoices.map(inv => {
          const meta = invoiceStatusMeta(inv.status, inv.dueDate);
          const isExpanded = selectedInv === inv.id;
          const isPending = meta.effectiveStatus === "sent" || meta.effectiveStatus === "overdue";
          return (
            <div key={inv.id} style={{
              background: "#fff",
              border: isExpanded ? `2px solid ${green}` : `1.5px solid ${isPending ? "#fde68a" : "#e4e7ec"}`,
              borderRadius: "16px", overflow: "hidden",
              boxShadow: isExpanded ? `0 4px 16px ${green}12` : "none",
              transition: "all 0.15s",
            }}>
              <button onClick={() => setSelectedInv(isExpanded ? null : inv.id)}
                style={{ width: "100%", background: "none", border: "none",
                  cursor: "pointer", padding: "16px 18px", textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px",
                      flexWrap: "wrap", marginBottom: "4px" }}>
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        fontWeight: 600, color: "#111827" }}>
                        {inv.type === "week" && inv.weekLabel ? `Week of ${inv.weekLabel}` : `${inv.items.length} walk${inv.items.length !== 1 ? "s" : ""}`}
                      </span>
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                        fontWeight: 700, color: meta.color,
                        background: meta.bg, border: `1px solid ${meta.border}`,
                        borderRadius: "5px", padding: "1px 7px" }}>{meta.label}</span>
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#9ca3af" }}>
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
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                      fontWeight: 600, color: meta.effectiveStatus === "paid" ? "#059669" : "#111827" }}>
                      ${(inv.total + (inv.gratuity || 0)).toFixed(2)}
                    </div>
                    <div style={{ fontSize: "16px", color: isExpanded ? green : "#d1d5db",
                      transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</div>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div style={{ borderTop: "1px solid #f3f4f6", padding: "16px 18px" }}>
                  {/* Line items */}
                  <div style={{ background: "#f9fafb", borderRadius: "10px",
                    padding: "12px 14px", marginBottom: "16px" }}>
                    {inv.items.map((it, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between",
                        alignItems: "center", padding: "7px 0",
                        borderBottom: i < inv.items.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                        <span style={{ fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", color: "#374151" }}>{it.description}</span>
                        <span style={{ fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 600, color: "#111827",
                          flexShrink: 0, marginLeft: "12px" }}>${it.amount}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: "1.5px solid #e4e7ec", marginTop: "4px", paddingTop: "10px",
                      display: "flex", flexDirection: "column", gap: "6px" }}>
                      {/* Walk total */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontFamily: "'DM Sans', sans-serif",
                          fontSize: "14px", color: "#6b7280" }}>Walk Total</span>
                        <span style={{ fontFamily: "'DM Sans', sans-serif",
                          fontSize: "14px", fontWeight: 600, color: "#111827" }}>${inv.total}</span>
                      </div>
                      {/* Gratuity row */}
                      {inv.gratuity > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontFamily: "'DM Sans', sans-serif",
                            fontSize: "14px", color: "#C4541A", fontWeight: 500 }}>Gratuity</span>
                          <span style={{ fontFamily: "'DM Sans', sans-serif",
                            fontSize: "14px", fontWeight: 600, color: "#C4541A" }}>
                            +${Number(inv.gratuity).toFixed(2)}
                          </span>
                        </div>
                      )}
                      {/* Grand total */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                        borderTop: "1px solid #e4e7ec", paddingTop: "6px", marginTop: "2px" }}>
                        <span style={{ fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 700, color: "#111827" }}>Total</span>
                        <span style={{ fontFamily: "'DM Sans', sans-serif",
                          fontSize: "15px", fontWeight: 700,
                          color: meta.effectiveStatus === "paid" ? "#059669" : green }}>
                          ${(inv.total + (inv.gratuity || 0)).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {inv.notes && (
                    <div style={{ background: "#f9fafb", borderRadius: "8px",
                      padding: "10px 12px", marginBottom: "14px",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: "#6b7280", lineHeight: "1.5" }}>
                      📝 {inv.notes}
                    </div>
                  )}

                  {/* Pay button */}
                  {isPending && (
                    <button onClick={() => setPayingInv(inv)} style={{
                      width: "100%", padding: "13px", borderRadius: "11px", border: "none",
                      background: green, color: "#fff",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      fontWeight: 600, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    }}>
                      💳 Pay ${inv.total} Now
                    </button>
                  )}

                  {meta.effectiveStatus === "paid" && (
                    <div style={{ textAlign: "center", padding: "10px",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#059669", fontWeight: 600 }}>
                      ✅ This invoice has been paid. Thank you!
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


export default ClientInvoicesPage;
