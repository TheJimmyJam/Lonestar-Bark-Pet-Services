import { useState, useEffect, useRef } from "react";
import { WALKER_SERVICES } from "../../constants.js";
import { notifyAdmin, loadWalkerProfiles } from "../../supabase.js";
import { generateCode, formatPhone, emptyAddr, addrToString } from "../../helpers.js";
import PinPad from "../shared/PinPad.jsx";
import LogoBadge from "../shared/LogoBadge.jsx";
import AddressFields from "../shared/AddressFields.jsx";
import { GLOBAL_STYLES } from "../../styles.js";

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

function WalkerAuthScreen({ onLogin, onBack, onBackToLanding, onSetPin }) {
  const STORAGE_KEY = "dw_walker_email";
  const [stage, setStage]       = useState("entry");
  const [email, setEmail]       = useState("");
  const [emailError, setEmailError] = useState("");
  const [pinError, setPinError] = useState("");
  const [savedEmail, setSavedEmail] = useState(null);
  const [newPin, setNewPin]     = useState(null);

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
    const e = email.trim().toLowerCase();
    const cred = WALKER_CREDENTIALS[e];
    if (cred && cred.pin === pin) {
      try { localStorage.setItem(STORAGE_KEY, e); } catch {}
      const walkerData = getAllWalkers().find(w => w.id === cred.walkerId);
      onLogin({ ...walkerData, email: e, role: "walker" });
    } else {
      setPinError("Incorrect PIN."); setTimeout(() => setPinError(""), 100);
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
              <PinPad label="Enter your walker PIN" onComplete={handlePin} error={pinError} color={accentBlue} />
            </div>
            <button onClick={handleForgetMe} style={{
              marginTop: "20px", background: "none", border: "none", color: "#ffffffaa",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer",
              width: "100%", textAlign: "center" }}>
              {savedEmail ? "← Not you? Switch account" : "← Use a different email"}
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
                  ? "Welcome to Lonestar Bark Co.! Choose a 4-digit PIN you'll use to log in."
                  : "Enter your PIN one more time to confirm."}
              </div>
            </div>
            <PinPad
              label={stage === "setpin" ? "Choose a 4-digit PIN" : "Confirm PIN"}
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
export { getAllWalkers, injectCustomWalkers };
export default WalkerAuthScreen;
