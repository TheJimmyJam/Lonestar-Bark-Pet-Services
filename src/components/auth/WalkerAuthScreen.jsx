import { useState, useEffect, useRef } from "react";
import { WALKER_SERVICES } from "../../constants.js";
import { notifyAdmin, loadWalkerProfiles } from "../../supabase.js";
import { generateCode, formatPhone, emptyAddr, addrToString, firstName } from "../../helpers.js";
import PinPad from "../shared/PinPad.jsx";
import LogoBadge from "../shared/LogoBadge.jsx";
import AddressFields from "../shared/AddressFields.jsx";
import { GLOBAL_STYLES } from "../../styles.js";
import useRateLimiter from "../../hooks/useRateLimiter.js";

// ─── Shared mutable walker state ──────────────────────────────────────────────
// These are module-level so all files importing from here share the same references.
let WALKER_CREDENTIALS = {};
let CUSTOM_WALKERS = [];

// ─── Walker helpers ───────────────────────────────────────────────────────────
function getAllWalkers() {
  return [...CUSTOM_WALKERS].sort((a, b) =>
    firstName(a.name).localeCompare(firstName(b.name))
  );
}

// Inject custom walker profiles into the runtime registries
function injectCustomWalkers(walkerProfiles) {
  CUSTOM_WALKERS = [];
  Object.values(walkerProfiles).forEach(prof => {
    if (prof.deleted) return;
    CUSTOM_WALKERS.push({
      id: prof.id,
      name: prof.preferredName || prof.name,
      role: prof.role || "Dog Walker",
      years: prof.years || 0,
      color: prof.color || "#6b7280",
      avatar: prof.avatar || "🐾",
      bio: prof.bio || "",
    });
    if (prof.email && (prof.pin || prof.mustSetPin)) {
      WALKER_CREDENTIALS[prof.email.toLowerCase()] = {
        walkerId: prof.id,
        pin: prof.pin || null,
        mustSetPin: !!prof.mustSetPin,
      };
    }
  });
  // Also remove deleted walkers' credentials
  Object.values(walkerProfiles).forEach(prof => {
    if (prof.deleted && prof.email) {
      delete WALKER_CREDENTIALS[prof.email.toLowerCase()];
    }
  });
}

function WalkerAuthScreen({ onLogin, onBack, onBackToLanding, onSetPin, onRequestPinReset, onVerifyPinReset }) {
  const STORAGE_KEY = "dw_walker_email";
  const [stage, setStage]       = useState("entry");
  const [email, setEmail]       = useState("");
  const [emailError, setEmailError] = useState("");
  const [pinError, setPinError] = useState("");
  const [savedEmail, setSavedEmail] = useState(null);
  const [newPin, setNewPin]     = useState(null);
  const [resetEmail, setResetEmail] = useState("");
  const [resetEmailError, setResetEmailError] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetCodeError, setResetCodeError] = useState("");
  const [resetSending, setResetSending] = useState(false);
  const rateLimiter = useRateLimiter(email);

  // On mount: check for a previously saved email
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && WALKER_CREDENTIALS[stored]) {
        const cred = WALKER_CREDENTIALS[stored];
        setSavedEmail(stored);
        setEmail(stored);
        setStage(cred.mustSetPin ? "setpin" : "pin");
      }
    } catch {}
  }, []);

  const handleEmailSubmit = () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { setEmailError("Please enter a valid email."); return; }
    if (!WALKER_CREDENTIALS[e]) { setEmailError("No walker account found with that email."); return; }
    const cred = WALKER_CREDENTIALS[e];
    setEmailError("");
    setStage(cred.mustSetPin ? "setpin" : "pin");
  };

  const handlePin = (pin) => {
    if (rateLimiter.locked) return;
    const e = email.trim().toLowerCase();
    const cred = WALKER_CREDENTIALS[e];
    if (cred && cred.pin === pin) {
      rateLimiter.clearFailures();
      try { localStorage.setItem(STORAGE_KEY, e); } catch {}
      const walkerData = getAllWalkers().find(w => w.id === cred.walkerId);
      onLogin({ ...walkerData, email: e, role: "walker" });
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

  const handleSetPin = (pin) => {
    if (!newPin) {
      setNewPin(pin);
      setStage("confirmpin");
      return;
    }
    if (pin !== newPin) {
      setPinError("PINs don't match — try again."); setTimeout(() => setPinError(""), 100);
      setNewPin(null); setStage("setpin"); return;
    }
    const e = email.trim().toLowerCase();
    const cred = WALKER_CREDENTIALS[e];
    WALKER_CREDENTIALS[e] = { ...cred, pin, mustSetPin: false };
    if (onSetPin) onSetPin(e, pin);
    try { localStorage.setItem(STORAGE_KEY, e); } catch {}
    const walkerData = getAllWalkers().find(w => w.id === cred.walkerId);
    onLogin({ ...walkerData, email: e, role: "walker" });
  };

  const handleForgetMe = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setSavedEmail(null);
    setEmail("");
    setNewPin(null);
    setStage("entry");
  };

  const accentBlue = "#3D6B7A";

  return (
    <div style={{ minHeight: "100svh",
      background: "linear-gradient(135deg,#112830 0%,#1A3A42 50%,#112830 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "clamp(20px,5vw,48px) 16px" }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ textAlign: "center", marginBottom: "40px" }}>
        <div style={{ fontSize: "40px", marginBottom: "10px" }}>🦺</div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
          fontSize: "15px", textTransform: "uppercase", fontWeight: 600, letterSpacing: "2px", marginBottom: "4px" }}>
          Walker Portal
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#4E7A8C",
          fontSize: "15px", letterSpacing: "3px", textTransform: "uppercase" }}>
          Lonestar Bark Co.
        </div>
      </div>

      <div className="auth-card" style={{ background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.09)", borderRadius: "24px", padding: "36px 32px" }}>
        {stage === "entry" && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb", fontSize: "15px",
              textAlign: "center", marginBottom: "24px" }}>
              Enter your walker email to continue.
            </div>
            <input type="email" placeholder="you@lonestarbark.com" value={email}
              onChange={e => { setEmail(e.target.value); setEmailError(""); }}
              onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
              style={{ width: "100%", padding: "14px 16px", borderRadius: "12px",
                border: emailError ? "1.5px solid #ef4444" : "1.5px solid #2A6070",
                background: "#1A3A42", color: "#fff", fontSize: "15px",
                fontFamily: "'DM Sans', sans-serif", marginBottom: "12px" }} />
            {emailError && <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", marginBottom: "10px" }}>{emailError}</div>}
            <button onClick={handleEmailSubmit} style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: accentBlue, color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 500, cursor: "pointer" }}>Continue →</button>
          </div>
        )}
        {stage === "pin" && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "8px" }}>
              {savedEmail ? (
                <>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
                    fontSize: "15px", marginBottom: "4px" }}>Welcome back!</div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "8px",
                    background: "rgba(42,74,127,0.3)", borderRadius: "20px",
                    padding: "5px 12px 5px 10px", marginBottom: "4px" }}>
                    <span style={{ fontSize: "16px" }}>🦺</span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                      fontSize: "15px", fontWeight: 500 }}>{savedEmail}</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
                    fontSize: "15px", marginBottom: "4px" }}>Welcome back!</div>
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
                <PinPad label="Enter your walker PIN" onComplete={handlePin} error={pinError} color={accentBlue} />
              )}
            </div>
            <button onClick={handleForgetMe} style={{
              marginTop: "20px", background: "none", border: "none", color: "#ffffffaa",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer",
              width: "100%", textAlign: "center" }}>
              {savedEmail ? "← Not you? Switch account" : "← Use a different email"}
            </button>
            <button onClick={() => { setResetEmail(savedEmail || email); setResetEmailError(""); setStage("forgot-email"); }}
              style={{ marginTop: "10px", background: "none", border: "none", color: accentBlue,
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
              Enter your walker email and we'll send you a 6-digit reset code.
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
                if (!ok) { setResetEmailError("No walker account found with that email."); return; }
                setResetCodeError(""); setResetCode(""); setStage("forgot-code");
              }}
              style={{ width: "100%", padding: "13px", background: accentBlue, color: "#fff",
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
                setNewPin(null); setStage("setpin");
              }}
              style={{ width: "100%", padding: "13px", background: accentBlue, color: "#fff",
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

        {(stage === "setpin" || stage === "confirmpin") && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>🔐</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, marginBottom: "6px" }}>
                {stage === "setpin" ? "Set Your PIN" : "Confirm Your PIN"}
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#4E7A8C",
                fontSize: "16px", lineHeight: "1.6" }}>
                {stage === "setpin"
                  ? "Welcome to Lonestar Bark Co.! Choose a 6-digit PIN you'll use to log in."
                  : "Enter your PIN one more time to confirm."}
              </div>
            </div>
            <PinPad
              label={stage === "setpin" ? "Choose a 6-digit PIN" : "Confirm PIN"}
              onComplete={handleSetPin}
              error={pinError}
              color={accentBlue}
            />
            <button onClick={handleForgetMe} style={{
              marginTop: "20px", background: "none", border: "none", color: "#ffffffaa",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer",
              width: "100%", textAlign: "center" }}>
              ← Use a different email
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

// ─── Admin Auth Screen ────────────────────────────────────────────────────────
export { getAllWalkers, injectCustomWalkers, WALKER_CREDENTIALS, CUSTOM_WALKERS };
export default WalkerAuthScreen;
