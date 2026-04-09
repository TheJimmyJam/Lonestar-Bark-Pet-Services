import { useState } from "react";
import { sbFetch } from "../../supabase.js";
import { CUSTOM_WALKERS, WALKER_CREDENTIALS, injectCustomWalkers } from "../auth/WalkerAuthScreen.jsx";

// ─── Admin Danger Zone (full system reset) ────────────────────────────────────
function AdminDangerZone({ admin, adminList, setAdminList, setClients, setWalkerProfiles, onLogout }) {
  const [stage, setStage] = useState("idle"); // idle | step1 | step2 | step3 | deleting
  const [pinInput, setPinInput]   = useState("");
  const [pinError, setPinError]   = useState("");

  const me = adminList.find(a => a.id === admin.id);

  const handlePinContinue = () => {
    if (!me || pinInput !== me.pin) {
      setPinError("Incorrect PIN."); return;
    }
    setPinError(""); setStage("step2");
  };

  const handleReset = async () => {
    setStage("deleting");
    try {
      // Delete everything from every table
      await Promise.all([
        sbFetch("clients?email=not.is.null",           { method: "DELETE", headers: { "Prefer": "" } }),
        sbFetch("walkers?walker_id=gt.0",              { method: "DELETE", headers: { "Prefer": "" } }),
        sbFetch("invoices?id=not.is.null",             { method: "DELETE", headers: { "Prefer": "" } }),
        sbFetch("trades?id=gt.0",                      { method: "DELETE", headers: { "Prefer": "" } }),
        sbFetch("payrolls?id=gt.0",                    { method: "DELETE", headers: { "Prefer": "" } }),
        sbFetch("messages?id=not.is.null",             { method: "DELETE", headers: { "Prefer": "" } }),
        sbFetch("client_messages?id=not.is.null",      { method: "DELETE", headers: { "Prefer": "" } }),
        sbFetch(`admins?id=neq.${encodeURIComponent(admin.id)}`, { method: "DELETE", headers: { "Prefer": "" } }),
      ]);
    } catch (e) {
      console.error("Reset error:", e);
    }
    // Clear all local state
    setClients({});
    injectCustomWalkers({}); // wipe CUSTOM_WALKERS array + injected WALKER_CREDENTIALS
    setWalkerProfiles({});
    setAdminList([me]); // keep only current admin
    // Log out so they see a clean app
    setTimeout(() => onLogout(), 1200);
  };

  const amber = "#b45309";

  return (
    <div style={{ background: "#fff", borderRadius: "16px",
      border: "2px solid #fca5a5", padding: "24px", marginTop: "24px" }}>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
        <span style={{ fontSize: "20px" }}>☠️</span>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
          textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700,
          color: "#dc2626" }}>Danger Zone</div>
      </div>

      {stage === "idle" && (
        <>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            color: "#6b7280", marginBottom: "20px", lineHeight: "1.6" }}>
            Permanently erase <strong style={{ color: "#111827" }}>all clients, walkers, bookings,
            invoices, chat messages, and payroll records</strong> from the system. This cannot be undone.
          </p>
          <button onClick={() => setStage("step1")} style={{
            padding: "12px 20px", borderRadius: "10px",
            border: "1.5px solid #fca5a5", background: "#fff5f5",
            color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
            ☠️ Reset All Data…
          </button>
        </>
      )}

      {stage === "step1" && (
        <div className="fade-up">
          <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5",
            borderRadius: "10px", padding: "14px 16px", marginBottom: "20px" }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
              color: "#dc2626", fontSize: "15px", marginBottom: "4px" }}>
              ⚠️ This will permanently delete everything.
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#7f1d1d" }}>
              All clients, walkers, bookings, invoices, chat history, and payroll data will be wiped from
              the database. There is no recovery. Enter your PIN to proceed.
            </div>
          </div>

          <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", fontWeight: 700, color: "#9ca3af",
            letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "6px" }}>
            Your Admin PIN
          </label>
          <input type="password" inputMode="numeric" maxLength={4}
            placeholder="••••" value={pinInput}
            onChange={e => { setPinInput(e.target.value.replace(/\D/g, "")); setPinError(""); }}
            onKeyDown={e => e.key === "Enter" && handlePinContinue()}
            style={{ width: "100%", padding: "13px 14px", borderRadius: "10px",
              border: `1.5px solid ${pinError ? "#ef4444" : "#e4e7ec"}`,
              background: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "22px", letterSpacing: "10px", color: "#111827",
              outline: "none", marginBottom: "6px", boxSizing: "border-box" }} />
          {pinError && <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
            fontSize: "14px", marginBottom: "10px" }}>{pinError}</div>}

          <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
            <button onClick={handlePinContinue}
              disabled={pinInput.length < 4}
              style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none",
                background: pinInput.length < 4 ? "#e4e7ec" : "#dc2626",
                color: pinInput.length < 4 ? "#9ca3af" : "#fff",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                fontWeight: 600, cursor: pinInput.length < 4 ? "default" : "pointer" }}>
              Continue →
            </button>
            <button onClick={() => { setStage("idle"); setPinInput(""); setPinError(""); }}
              style={{ padding: "12px 18px", borderRadius: "10px",
                border: "1.5px solid #e4e7ec", background: "#f9fafb",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#374151", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "step2" && (
        <div className="fade-up">
          <div style={{ background: "#fef2f2", border: "2px solid #ef4444",
            borderRadius: "10px", padding: "16px 18px", marginBottom: "20px" }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
              color: "#dc2626", fontSize: "16px", marginBottom: "6px" }}>
              First confirmation
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
              color: "#7f1d1d", lineHeight: "1.6" }}>
              You are about to permanently delete <strong>all data</strong> in the system.
              Every client record, booking, walker profile, invoice, and message will be gone forever.
              Click the button below to confirm this is what you want.
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setStage("step3")} style={{
              flex: 1, padding: "13px", borderRadius: "10px", border: "2px solid #dc2626",
              background: "#fef2f2", color: "#dc2626",
              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              fontWeight: 700, cursor: "pointer" }}>
              I confirm I'm deleting all data
            </button>
            <button onClick={() => { setStage("idle"); setPinInput(""); }}
              style={{ padding: "12px 18px", borderRadius: "10px",
                border: "1.5px solid #e4e7ec", background: "#f9fafb",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#374151", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "step3" && (
        <div className="fade-up">
          <div style={{ background: "#7f1d1d", borderRadius: "10px",
            padding: "18px 20px", marginBottom: "20px" }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
              color: "#fff", fontSize: "17px", marginBottom: "8px" }}>
              ☠️ Final confirmation — this is your last chance.
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
              color: "#fca5a5", lineHeight: "1.7" }}>
              Once you click below, <strong style={{ color: "#fff" }}>everything is gone</strong>.
              All clients. All walkers. All bookings. All invoices. All messages. All payroll records.
              The database will be wiped and you will be logged out. This action is <strong style={{ color: "#fff" }}>irreversible</strong>.
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={handleReset} style={{
              flex: 1, padding: "14px", borderRadius: "10px", border: "none",
              background: "#dc2626", color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              fontWeight: 700, cursor: "pointer",
              boxShadow: "0 4px 14px rgba(220,38,38,0.4)" }}>
              I confirm I'm deleting all data
            </button>
            <button onClick={() => { setStage("idle"); setPinInput(""); }}
              style={{ padding: "12px 18px", borderRadius: "10px",
                border: "1.5px solid #e4e7ec", background: "#f9fafb",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#374151", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "deleting" && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
            color: "#dc2626", fontWeight: 600, marginBottom: "6px" }}>
            Deleting all data…
          </div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#9ca3af" }}>
            Please wait. You'll be logged out when complete.
          </div>
        </div>
      )}
    </div>
  );
}


export default AdminDangerZone;
