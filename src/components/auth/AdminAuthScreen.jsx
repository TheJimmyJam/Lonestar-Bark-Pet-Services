import { useState, useEffect, useRef } from "react";
import { sbFetch, notifyAdmin, saveAdminList } from "../../supabase.js";
import { generateCode } from "../../helpers.js";
import PinPad from "../shared/PinPad.jsx";
import LogoBadge from "../shared/LogoBadge.jsx";
import { GLOBAL_STYLES } from "../../styles.js";
import useRateLimiter from "../../hooks/useRateLimiter.js";

// ─── Admin Auth Screen ────────────────────────────────────────────────────────
function AdminAuthScreen({ onLogin, onBack, onBackToLanding, adminList, setAdminList, onRequestPinReset, onVerifyPinReset }) {
  const STORAGE_KEY = "dw_admin_email";
  const amber = "#b45309";

  const [stage, setStage]         = useState("entry");   // "entry" | "pin" | "setup" | "forgot-email" | "forgot-code"
  const [email, setEmail]         = useState("");
  const [savedEmail, setSavedEmail] = useState(null);
  const [emailError, setEmailError] = useState("");
  const [pinError, setPinError]   = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetEmailError, setResetEmailError] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetCodeError, setResetCodeError] = useState("");
  const [resetSending, setResetSending] = useState(false);

  const rateLimiter = useRateLimiter(savedEmail || email);

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
    if (rateLimiter.locked) return;
    const e = (savedEmail || email).trim().toLowerCase();
    const found = adminList.find(a => a.email.toLowerCase() === e && a.status === "active");
    if (found && pin === found.pin) {
      rateLimiter.clearFailures();
      try { localStorage.setItem(STORAGE_KEY, found.email); } catch {}
      onLogin({ id: found.id, name: found.name, role: "admin", email: found.email });
    } else {
      const nowLocked = rateLimiter.recordFailure();
      if (nowLocked) {
        setPinError("Too many failed attempts. Account locked."); setTimeout(() => setPinError(""), 100);
      } else {
        setPinError(`Incorrect PIN. ${rateLimiter.attemptsLeft - 1} attempt${rateLimiter.attemptsLeft - 1 === 1 ? "" : "s"} remaining.`);
        setTimeout(() => setPinError(""), 100);
      }
    }
  };

  const handleSetupSubmit = () => {
    const errs = {};
    if (!setupName.trim()) errs.name = "Please enter your name.";
    if (!/^\d{6}$/.test(setupPin)) errs.pin = "PIN must be exactly 6 digits.";
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
              {rateLimiter.locked ? (
                <div style={{ textAlign: "center", padding: "24px 16px" }}>
                  <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔒</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ef4444",
                    fontSize: "15px", fontWeight: 600, marginBottom: "8px" }}>
                    Account Locked
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
                    fontSize: "15px", lineHeight: "1.6", marginBottom: "12px" }}>
                    Too many failed PIN attempts. Try again in:
                  </div>
                  <div style={{ fontFamily: "'DM Sans', monospace", color: "#fff",
                    fontSize: "28px", fontWeight: 700, letterSpacing: "2px" }}>
                    {rateLimiter.formatRemaining()}
                  </div>
                </div>
              ) : (
                <PinPad label="Enter your PIN" onComplete={handlePin} error={pinError} color={amber} />
              )}
            </div>
            <button onClick={handleForgetMe} style={{
              marginTop: "20px", background: "none", border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "8px", padding: "9px 16px", color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: "14px", cursor: "pointer",
              width: "100%", textAlign: "center", opacity: 0.75 }}>
              {savedEmail ? "← Not you? Switch account" : "← Use a different email"}
            </button>
            <button onClick={() => { setResetEmail(savedEmail || email); setResetEmailError(""); setStage("forgot-email"); }}
              style={{ marginTop: "10px", background: "none", border: "none", color: amber,
                fontFamily: "'DM Sans', sans-serif", fontSize: "14px", cursor: "pointer",
                width: "100%", textAlign: "center", textDecoration: "underline" }}>
              Forgot PIN?
            </button>
          </div>
        )}

        {/* Forgot PIN — enter email */}
        {stage === "forgot-email" && (
          <div className="fade-up" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔑</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffff", fontSize: "20px",
              fontWeight: 700, marginBottom: "8px" }}>Reset Your PIN</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa", fontSize: "14px",
              lineHeight: "1.6", marginBottom: "24px" }}>
              Enter your admin email and we'll send you a 6-digit reset code.
            </div>
            <input type="email" value={resetEmail}
              onChange={e => { setResetEmail(e.target.value); setResetEmailError(""); }}
              placeholder="your@email.com"
              style={{ width: "100%", padding: "12px 16px", borderRadius: "10px",
                border: resetEmailError ? "1.5px solid #ef4444" : "1.5px solid #444",
                background: "rgba(255,255,255,0.08)", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", boxSizing: "border-box", marginBottom: "8px", outline: "none" }} />
            {resetEmailError && <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "8px" }}>{resetEmailError}</div>}
            <button disabled={resetSending}
              onClick={async () => {
                if (!resetEmail.trim()) { setResetEmailError("Enter your email."); return; }
                setResetSending(true);
                const ok = await onRequestPinReset(resetEmail.trim().toLowerCase());
                setResetSending(false);
                if (!ok) { setResetEmailError("No admin account found with that email."); return; }
                setResetCodeError(""); setResetCode(""); setStage("forgot-code");
              }}
              style={{ width: "100%", padding: "13px", background: amber, color: "#fff",
                border: "none", borderRadius: "10px", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 700, cursor: resetSending ? "not-allowed" : "pointer",
                opacity: resetSending ? 0.7 : 1, marginBottom: "12px" }}>
              {resetSending ? "Sending…" : "Send Reset Code"}
            </button>
            <button onClick={() => setStage("pin")}
              style={{ background: "none", border: "none", color: "#ffffffaa", fontFamily: "'DM Sans', sans-serif",
                fontSize: "14px", cursor: "pointer", textDecoration: "underline" }}>
              Back to login
            </button>
          </div>
        )}

        {/* Forgot PIN — enter code */}
        {stage === "forgot-code" && (
          <div className="fade-up" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>📬</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffff", fontSize: "20px",
              fontWeight: 700, marginBottom: "8px" }}>Check Your Email</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa", fontSize: "14px",
              lineHeight: "1.6", marginBottom: "24px" }}>
              We sent a 6-digit code to <strong style={{ color: "#fff" }}>{resetEmail}</strong>.<br/>
              Enter it below. It expires in 15 minutes.
            </div>
            <input type="text" inputMode="numeric" maxLength={6} value={resetCode}
              onChange={e => { setResetCode(e.target.value.replace(/\D/g, "")); setResetCodeError(""); }}
              placeholder="000000"
              style={{ width: "100%", padding: "14px 16px", borderRadius: "10px",
                border: resetCodeError ? "1.5px solid #ef4444" : "1.5px solid #444",
                background: "rgba(255,255,255,0.08)", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "28px", fontWeight: 700, letterSpacing: "8px", textAlign: "center",
                boxSizing: "border-box", marginBottom: "8px", outline: "none" }} />
            {resetCodeError && <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "8px" }}>{resetCodeError}</div>}
            <button onClick={() => {
                if (resetCode.length !== 6) { setResetCodeError("Enter the 6-digit code from your email."); return; }
                const valid = onVerifyPinReset(resetEmail, resetCode);
                if (!valid) { setResetCodeError("Invalid or expired code. Try again."); return; }
                setSetupPin(""); setSetupPin2(""); setSetupErrors({});
                setStage("reset-pin");
              }}
              style={{ width: "100%", padding: "13px", background: amber, color: "#fff",
                border: "none", borderRadius: "10px", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 700, cursor: "pointer", marginBottom: "12px" }}>
              Verify Code
            </button>
            <button onClick={() => setStage("forgot-email")}
              style={{ background: "none", border: "none", color: "#ffffffaa", fontFamily: "'DM Sans', sans-serif",
                fontSize: "14px", cursor: "pointer", textDecoration: "underline" }}>
              Resend code
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
                textTransform: "uppercase", marginBottom: "6px" }}>Choose a 6-Digit PIN</label>
              <input type="password" inputMode="numeric" maxLength={6} placeholder="••••••" value={setupPin}
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
              <input type="password" inputMode="numeric" maxLength={6} placeholder="••••••" value={setupPin2}
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

        {/* Reset PIN — set new PIN after code verified */}
        {stage === "reset-pin" && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>🔐</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff", fontSize: "20px",
                fontWeight: 700, marginBottom: "6px" }}>Choose a New PIN</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa", fontSize: "14px" }}>
                Pick a new 6-digit PIN for your admin account.
              </div>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                fontWeight: 700, color: "#ffffffaa", letterSpacing: "1px", textTransform: "uppercase",
                marginBottom: "6px" }}>New PIN</label>
              <input type="password" inputMode="numeric" maxLength={6} placeholder="••••••" value={setupPin}
                onChange={e => { setSetupPin(e.target.value.replace(/\D/g,"")); setSetupErrors(p => ({ ...p, pin: "" })); }}
                style={{ width: "100%", padding: "13px 14px", borderRadius: "12px", boxSizing: "border-box",
                  border: setupErrors.pin ? "1.5px solid #ef4444" : "1.5px solid #8B5220",
                  background: "#5C3818", color: "#fff", fontSize: "20px", letterSpacing: "8px",
                  fontFamily: "'DM Sans', sans-serif" }} />
              {setupErrors.pin && <div style={{ color: "#ef4444", fontSize: "13px", marginTop: "4px" }}>{setupErrors.pin}</div>}
            </div>
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                fontWeight: 700, color: "#ffffffaa", letterSpacing: "1px", textTransform: "uppercase",
                marginBottom: "6px" }}>Confirm New PIN</label>
              <input type="password" inputMode="numeric" maxLength={6} placeholder="••••••" value={setupPin2}
                onChange={e => { setSetupPin2(e.target.value.replace(/\D/g,"")); setSetupErrors(p => ({ ...p, pin2: "" })); }}
                style={{ width: "100%", padding: "13px 14px", borderRadius: "12px", boxSizing: "border-box",
                  border: setupErrors.pin2 ? "1.5px solid #ef4444" : "1.5px solid #8B5220",
                  background: "#5C3818", color: "#fff", fontSize: "20px", letterSpacing: "8px",
                  fontFamily: "'DM Sans', sans-serif" }} />
              {setupErrors.pin2 && <div style={{ color: "#ef4444", fontSize: "13px", marginTop: "4px" }}>{setupErrors.pin2}</div>}
            </div>
            <button onClick={() => {
                const errs = {};
                if (!/^\d{6}$/.test(setupPin)) errs.pin = "PIN must be exactly 6 digits.";
                if (setupPin !== setupPin2) errs.pin2 = "PINs don't match.";
                if (Object.keys(errs).length) { setSetupErrors(errs); return; }
                const e = resetEmail.trim().toLowerCase();
                const admin = adminList.find(a => a.email?.toLowerCase() === e && a.status === "active");
                if (!admin) return;
                const updated = adminList.map(a =>
                  a.id === admin.id ? { ...a, pin: setupPin, resetCode: null, resetCodeExpiry: null } : a
                );
                setAdminList(updated);
                saveAdminList(updated);
                try { localStorage.setItem(STORAGE_KEY, admin.email); } catch {}
                onLogin({ id: admin.id, name: admin.name, role: "admin", email: admin.email });
              }}
              style={{ width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "16px", fontWeight: 600, cursor: "pointer" }}>
              Save New PIN & Log In →
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
