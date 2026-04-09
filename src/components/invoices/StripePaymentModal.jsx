import { useState, useEffect, useRef } from "react";
import { SUPABASE_URL } from "../../supabase.js";
import { fmt } from "../../helpers.js";

// ─── Stripe Payment Modal (framework) ─────────────────────────────────────────
function StripePaymentModal({ invoice, client, onClose, onPaid }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [gratuity, setGratuity] = useState("");

  const gratuityAmt = parseFloat(gratuity) || 0;
  const totalWithTip = invoice.total + gratuityAmt;

  const handlePay = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice.id,
          amount: totalWithTip,
          clientName: client?.name || "Client",
          clientEmail: client?.email || "",
          description: gratuityAmt > 0
            ? `Lonestar Bark Co. — Invoice ${invoice.id} (incl. $${gratuityAmt.toFixed(2)} gratuity)`
            : `Lonestar Bark Co. — Invoice ${invoice.id}`,
        }),
      });
      const data = await res.json();
      if (data.url) {
        try { localStorage.setItem("dwi_stripe_return_clientId", client?.id || ""); } catch {}
        if (gratuityAmt > 0) {
          try { localStorage.setItem("dwi_stripe_gratuity", JSON.stringify({ invoiceId: invoice.id, amount: gratuityAmt })); } catch {}
        }
        window.location.href = data.url;
      } else {
        setError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
      }
    } catch (e) {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ background: "#fff", borderRadius: "20px", width: "100%", maxWidth: "400px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.22)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ background: "#6B3A18", padding: "20px 24px", display: "flex",
          alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase",
              letterSpacing: "1.5px", fontWeight: 600, color: "#fff" }}>Pay Invoice</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              color: "#ffffff99", marginTop: "2px" }}>{invoice.id}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none",
            color: "#ffffff99", fontSize: "22px", cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        {/* Amount due */}
        <div style={{ background: "#FDF5EC", borderBottom: "1.5px solid #D4A87A",
          padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#374151" }}>Amount due</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase",
            letterSpacing: "1.5px", fontWeight: 600, color: "#C4541A" }}>${invoice.total}</div>
        </div>

        <div style={{ padding: "24px" }}>

          {/* Gratuity input */}
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600,
              letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "8px" }}>
              Add Gratuity <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional — goes 100% to your walker)</span>
            </div>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>$</span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={gratuity}
                onChange={e => setGratuity(e.target.value.replace(/[^0-9.]/g, ""))}
                style={{ width: "100%", padding: "11px 14px 11px 28px", borderRadius: "10px",
                  border: "1.5px solid #d1d5db", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "16px", color: "#111827", outline: "none" }}
              />
            </div>
            {gratuityAmt > 0 && (
              <div className="fade-up" style={{ marginTop: "10px", padding: "10px 14px",
                background: "#FDF5EC", border: "1.5px solid #D4A87A", borderRadius: "10px",
                display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>
                  Invoice ${invoice.total} + tip ${gratuityAmt.toFixed(2)}
                </span>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 700, color: "#C4541A" }}>
                  Total ${totalWithTip.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
            lineHeight: "1.6", marginBottom: "20px" }}>
            You'll be redirected to Stripe's secure checkout to complete your payment. After paying you'll be brought back here automatically.
          </p>

          {error && (
            <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: "10px",
              padding: "12px 14px", marginBottom: "16px", fontFamily: "'DM Sans', sans-serif",
              fontSize: "14px", color: "#dc2626" }}>{error}</div>
          )}

          <button onClick={handlePay} disabled={loading} style={{
            width: "100%", padding: "15px", borderRadius: "12px", border: "none",
            background: loading ? "#9ca3af" : "#635bff", color: "#fff",
            fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            fontWeight: 700, cursor: loading ? "default" : "pointer" }}>
            {loading ? "Redirecting to Stripe…" : `🔒 Pay $${totalWithTip.toFixed(2)} with Stripe`}
          </button>

          <div style={{ textAlign: "center", marginTop: "12px", fontFamily: "'DM Sans', sans-serif",
            fontSize: "13px", color: "#9ca3af" }}>
            Powered by <strong style={{ color: "#635bff" }}>Stripe</strong> · Secured with SSL
          </div>
        </div>
      </div>
    </div>
  );
}


export default StripePaymentModal;
