import { useState, useEffect, useRef } from "react";
import { sbFetch, notifyAdmin, saveAdminList } from "../../supabase.js";
import { generateCode } from "../../helpers.js";
import PinPad from "../shared/PinPad.jsx";
import LogoBadge from "../shared/LogoBadge.jsx";
import { GLOBAL_STYLES } from "../../styles.js";

// ─── Admin Auth Screen ────────────────────────────────────────────────────────
function AdminAuthScreen({ onLogin, onBack, onBackToLanding, adminList, setAdminList }) {
  const STORAGE_KEY = "dw_admin_email";
  const amber = "#b45309";

  const [stage, setStage]         = useState("entry");   // "entry" | "pin" | "setup"
  const [email, setEmail]         = useState("");
  const [savedEmail, setSavedEmail] = useState(null);
  const [emailError, setEmailError] = useState("");
  const [pinError, setPinError]   = useState("");

  // Setup (invite onboarding) state
  const [setupName, setSetupName]   = useState("");
  const [setupPin, setSetupPin]     = useState("");
  const [setupPin2, setSetupPin2]   = useState("");
  const [setupErrors, setSetupErrors] = useState({});
  const [pendingAdmin, setPendingAdmin] = useState(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const found = adminList.find(a => a.email.toLowerCase() === stored.toLowerCase());
        if (found && found.status === "active") {
          setSavedEmail(stored);
          setEmail(stored);
          setStage("pin");
        }
      }
    } catch {}
  }, []);

  const handleEmailSubmit = () => {
    const e = email.trim().toLowerCase();
    const found = adminList.find(a => a.email.toLowerCase() === e);
    if (!found) { setEmailError("No admin account found for this email."); return; }
    setEmailError("");
    if (found.status === "invited") {
      setPendingAdmin(found);
      setStage("setup");
    } else {
      setStage("pin");
    }
  };

  const handlePin = (pin) => {
    const e = (savedEmail || email).trim().toLowerCase();
    const found = adminList.find(a => a.email.toLowerCase() === e && a.status === "active");
    if (found && pin === found.pin) {
      try { localStorage.setItem(STORAGE_KEY, found.email); } catch {}
      onLogin({ id: found.id, name: found.name, role: "admin", email: found.email });
    } else {
      setPinError("Incorrect PIN."); setTimeout(() => setPinError(""), 100);
    }
  };

  const handleSetupSubmit = () => {
    const errs = {};
    if (!setupName.trim()) errs.name = "Please enter your name.";
    if (!/^\d{4}$/.test(setupPin)) errs.pin = "PIN must be exactly 4 digits.";
    if (setupPin !== setupPin2) errs.pin2 = "PINs don't match.";
    // Check PIN uniqueness
    const dupPin = adminList.find(a => a.id !== pendingAdmin.id && a.pin === setupPin && a.status === "active");
    if (dupPin) errs.pin = "That PIN is already in use by another admin. Choose a different one.";
    if (Object.keys(errs).length) { setSetupErrors(errs); return; }

    const updated = adminList.map(a =>
      a.id === pendingAdmin.id
        ? { ...a, name: setupName.trim(), pin: setupPin, status: "active" }
        : a
    );
    setAdminList(updated);
    saveAdminList(updated);
    try { localStorage.setItem(STORAGE_KEY, pendingAdmin.email); } catch {}
    onLogin({ id: pendingAdmin.id, name: setupName.trim(), role: "admin", email: pendingAdmin.email });
  };

  const handleForgetMe = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setSavedEmail(null); setEmail(""); setStage("entry");
  };

  return (
    <div style={{ minHeight: "100svh",
      background: "linear-gradient(135deg,#4D2E10 0%,#5C3818 50%,#4D2E10 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "clamp(20px,5vw,48px) 16px" }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ textAlign: "center", marginBottom: "40px" }}>
        <div style={{ fontSize: "40px", marginBottom: "10px" }}>🛡️</div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
          fontSize: "15px", textTransform: "uppercase", fontWeight: 600, letterSpacing: "2px", marginBottom: "4px" }}>
          Admin Portal
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: amber,
          fontSize: "15px", letterSpacing: "3px", textTransform: "uppercase" }}>
          Lonestar Bark Co.
        </div>
      </div>

      <div className="auth-card" style={{ background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.09)", borderRadius: "24px", padding: "36px 32px" }}>

        {stage === "entry" && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
              fontSize: "15px", textAlign: "center", marginBottom: "24px" }}>
              Enter your admin email to continue.
            </div>
            <input type="email" placeholder="admin@lonestarbark.com" value={email}
              onChange={e => { setEmail(e.target.value); setEmailError(""); }}
              onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
              style={{ width: "100%", padding: "14px 16px", borderRadius: "12px",
                border: emailError ? "1.5px solid #ef4444" : "1.5px solid #8B5220",
                background: "#5C3818", color: "#fff", fontSize: "15px",
                fontFamily: "'DM Sans', sans-serif", marginBottom: "12px", boxSizing: "border-box" }} />
            {emailError && <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", marginBottom: "10px" }}>{emailError}</div>}
            <button onClick={handleEmailSubmit} style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 500, cursor: "pointer" }}>Continue →</button>
          </div>
        )}

        {stage === "pin" && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "8px" }}>
              {savedEmail ? (
                <>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
                    fontSize: "15px", marginBottom: "6px" }}>Admin access</div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "8px",
                    background: "rgba(180,83,9,0.25)", borderRadius: "20px",
                    padding: "5px 12px 5px 10px", marginBottom: "4px" }}>
                    <span style={{ fontSize: "16px" }}>🛡️</span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                      fontSize: "15px", fontWeight: 500 }}>{savedEmail}</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
                    fontSize: "15px", marginBottom: "4px" }}>Admin access</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
                    fontSize: "16px" }}>{email.trim().toLowerCase()}</div>
                </>
              )}
            </div>
            <div style={{ marginTop: "24px" }}>
              <PinPad label="Enter your PIN" onComplete={handlePin} error={pinError} color={amber} />
            </div>
            <button onClick={handleForgetMe} style={{
              marginTop: "20px", background: "none", border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "8px", padding: "9px 16px", color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: "14px", cursor: "pointer",
              width: "100%", textAlign: "center", opacity: 0.75 }}>
              {savedEmail ? "← Not you? Switch account" : "← Use a different email"}
            </button>
          </div>
        )}

        {stage === "setup" && pendingAdmin && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "17px", fontWeight: 600, textAlign: "center", marginBottom: "6px" }}>
              You've been invited! 🎉
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "15px", textAlign: "center", marginBottom: "24px" }}>
              Set up your admin account for<br />
              <span style={{ color: amber }}>{pendingAdmin.email}</span>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 700, color: "#ffffffaa", letterSpacing: "1px",
                textTransform: "uppercase", marginBottom: "6px" }}>Your Name</label>
              <input type="text" placeholder="Jackie Smith" value={setupName}
                onChange={e => { setSetupName(e.target.value); setSetupErrors(p => ({ ...p, name: "" })); }}
                style={{ width: "100%", padding: "13px 14px", borderRadius: "12px", boxSizing: "border-box",
                  border: setupErrors.name ? "1.5px solid #ef4444" : "1.5px solid #8B5220",
                  background: "#5C3818", color: "#fff", fontSize: "15px",
                  fontFamily: "'DM Sans', sans-serif" }} />
              {setupErrors.name && <div style={{ color: "#ef4444", fontSize: "14px",
                fontFamily: "'DM Sans', sans-serif", marginTop: "4px" }}>{setupErrors.name}</div>}
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 700, color: "#ffffffaa", letterSpacing: "1px",
                textTransform: "uppercase", marginBottom: "6px" }}>Choose a 4-Digit PIN</label>
              <input type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={setupPin}
                onChange={e => { setSetupPin(e.target.value.replace(/\D/g,"")); setSetupErrors(p => ({ ...p, pin: "" })); }}
                style={{ width: "100%", padding: "13px 14px", borderRadius: "12px", boxSizing: "border-box",
                  border: setupErrors.pin ? "1.5px solid #ef4444" : "1.5px solid #8B5220",
                  background: "#5C3818", color: "#fff", fontSize: "20px", letterSpacing: "8px",
                  fontFamily: "'DM Sans', sans-serif" }} />
              {setupErrors.pin && <div style={{ color: "#ef4444", fontSize: "14px",
                fontFamily: "'DM Sans', sans-serif", marginTop: "4px" }}>{setupErrors.pin}</div>}
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 700, color: "#ffffffaa", letterSpacing: "1px",
                textTransform: "uppercase", marginBottom: "6px" }}>Confirm PIN</label>
              <input type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={setupPin2}
                onChange={e => { setSetupPin2(e.target.value.replace(/\D/g,"")); setSetupErrors(p => ({ ...p, pin2: "" })); }}
                style={{ width: "100%", padding: "13px 14px", borderRadius: "12px", boxSizing: "border-box",
                  border: setupErrors.pin2 ? "1.5px solid #ef4444" : "1.5px solid #8B5220",
                  background: "#5C3818", color: "#fff", fontSize: "20px", letterSpacing: "8px",
                  fontFamily: "'DM Sans', sans-serif" }} />
              {setupErrors.pin2 && <div style={{ color: "#ef4444", fontSize: "14px",
                fontFamily: "'DM Sans', sans-serif", marginTop: "4px" }}>{setupErrors.pin2}</div>}
            </div>

            <button onClick={handleSetupSubmit} style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 600, cursor: "pointer" }}>
              Complete Setup & Log In →
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginTop: "20px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none",
          color: "#ffffffaa", fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer" }}>
          ← Back to portal selector
        </button>
        <button onClick={onBackToLanding} style={{ background: "none", border: "none",
          color: "#ffffff55", fontFamily: "'DM Sans', sans-serif", fontSize: "15px", cursor: "pointer" }}>
          ← Back to homepage
        </button>
      </div>
    </div>
  );
}


export default AdminAuthScreen;
