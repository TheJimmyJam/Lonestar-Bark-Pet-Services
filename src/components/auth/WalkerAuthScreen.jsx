import { useState, useEffect } from "react";
import { notifyAdmin, loadWalkerProfiles, walkerSignIn, setWalkerAuthPin, authSendPasswordReset } from "../../supabase.js";
import { generateCode, formatPhone, emptyAddr, addrToString, firstName } from "../../helpers.js";
import LogoBadge from "../shared/LogoBadge.jsx";
import { GLOBAL_STYLES } from "../../styles.js";

// ─── Shared mutable walker state ──────────────────────────────────────────────
let WALKER_CREDENTIALS = {};
let CUSTOM_WALKERS = [];

function getAllWalkers() {
  return [...CUSTOM_WALKERS].sort((a, b) =>
    firstName(a.name).localeCompare(firstName(b.name))
  );
}

function injectCustomWalkers(walkerProfiles) {
  CUSTOM_WALKERS = [];
  WALKER_CREDENTIALS = {};
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
    if (prof.email && (prof.pin !== undefined || prof.mustSetPin)) {
      WALKER_CREDENTIALS[prof.email.toLowerCase()] = {
        walkerId: prof.id,
        pin: prof.pin || null,       // kept for auto-migration fallback only
        mustSetPin: !!prof.mustSetPin,
        name: prof.preferredName || prof.name,
      };
    }
  });
  Object.values(walkerProfiles).forEach(prof => {
    if (prof.deleted && prof.email) {
      delete WALKER_CREDENTIALS[prof.email.toLowerCase()];
    }
  });
}

// ─── Input + button style helpers ─────────────────────────────────────────────
const inputStyle = (hasError) => ({
  width: "100%", padding: "14px 16px", borderRadius: "12px",
  border: hasError ? "1.5px solid #ef4444" : "1.5px solid #2A6070",
  background: "#1A3A42", color: "#fff", fontSize: "15px",
  fontFamily: "'DM Sans', sans-serif", marginBottom: "12px",
  outline: "none", boxSizing: "border-box",
});

const btnPrimary = (accentBlue, disabled) => ({
  width: "100%", padding: "14px", borderRadius: "12px", border: "none",
  background: disabled ? "#2A5060" : accentBlue, color: "#fff",
  fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 500,
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.7 : 1,
});

const btnGhost = { background: "none", border: "none", color: "#ffffffaa",
  fontFamily: "'DM Sans', sans-serif", fontSize: "14px", cursor: "pointer",
  width: "100%", textAlign: "center", marginTop: "12px" };

const errStyle = { color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
  fontSize: "14px", marginBottom: "10px" };

// ─── Shared password field (must live outside WalkerAuthScreen so React doesn't
//     recreate it as a new component on every render, which would kill focus) ──
function PasswordField({ value, onChange, placeholder = "••••••••", label, onEnter, showPw, onToggleShowPw, hasError }) {
  return (
    <div style={{ position: "relative", marginBottom: "12px" }}>
      {label && <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
        fontSize: "13px", marginBottom: "6px" }}>{label}</div>}
      <input
        type={showPw ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onEnter && onEnter()}
        style={{ width: "100%", padding: "14px 48px 14px 16px", borderRadius: "12px",
          border: hasError ? "1.5px solid #ef4444" : "1.5px solid #2A6070",
          background: "#1A3A42", color: "#fff", fontSize: "15px",
          fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box", outline: "none" }}
      />
      <button onClick={onToggleShowPw}
        style={{ position: "absolute", right: "12px", top: label ? "calc(50% + 10px)" : "50%",
          transform: "translateY(-50%)", background: "none", border: "none",
          color: "#ffffff66", cursor: "pointer", fontSize: "18px", padding: "4px" }}>
        {showPw ? "🙈" : "👁"}
      </button>
    </div>
  );
}

// ─── WalkerAuthScreen ─────────────────────────────────────────────────────────
function WalkerAuthScreen({ onLogin, onBack, onBackToLanding, onSetPassword }) {
  const STORAGE_KEY = "dw_walker_email";
  const accentBlue  = "#3D6B7A";

  // stage: "entry" | "password" | "setpassword" | "forgot" | "forgot-sent"
  const [stage, setStage]               = useState("entry");
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [confirmPw, setConfirmPw]       = useState("");
  const [showPw, setShowPw]             = useState(false);
  const [savedEmail, setSavedEmail]     = useState(null);
  const [emailError, setEmailError]     = useState("");
  const [formError, setFormError]       = useState("");
  const [isLoading, setIsLoading]       = useState(false);

  // On mount: restore saved email from a previous session.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && WALKER_CREDENTIALS[stored]) {
        const cred = WALKER_CREDENTIALS[stored];
        setSavedEmail(stored);
        setEmail(stored);
        setStage(cred.mustSetPin ? "setpassword" : "password");
      }
    } catch {}
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleEmailSubmit = () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { setEmailError("Please enter a valid email."); return; }
    if (!WALKER_CREDENTIALS[e]) { setEmailError("No walker account found with that email."); return; }
    setEmailError("");
    setPassword(""); setConfirmPw(""); setFormError("");
    setStage(WALKER_CREDENTIALS[e].mustSetPin ? "setpassword" : "password");
  };

  const handleLogin = async () => {
    if (isLoading) return;
    const e = email.trim().toLowerCase();
    const cred = WALKER_CREDENTIALS[e];
    if (!password) { setFormError("Enter your password."); return; }
    setIsLoading(true); setFormError("");

    let result = await walkerSignIn(e, password);

    // Auto-migration: existing walkers whose old PIN matches — provision Supabase account on first login
    if (!result.success && cred && cred.pin === password) {
      await setWalkerAuthPin(e, password, cred.name);
      result = await walkerSignIn(e, password);
    }

    setIsLoading(false);
    if (result.success) {
      try { localStorage.setItem(STORAGE_KEY, e); } catch {}
      const walkerData = getAllWalkers().find(w => w.id === cred?.walkerId);
      onLogin({ ...walkerData, email: e, role: "walker" });
    } else {
      setFormError("Wrong password. Try again or use Forgot password.");
    }
  };

  const handleSetPassword = async () => {
    if (isLoading) return;
    const e = email.trim().toLowerCase();
    const cred = WALKER_CREDENTIALS[e];
    if (!password || password.length < 8) { setFormError("Password must be at least 8 characters."); return; }
    if (password !== confirmPw) { setFormError("Passwords don't match."); return; }
    setIsLoading(true); setFormError("");

    const setResult = await setWalkerAuthPin(e, password, cred?.name);
    if (!setResult.success) {
      setIsLoading(false);
      setFormError("Failed to save password — please try again.");
      return;
    }
    await walkerSignIn(e, password);
    setIsLoading(false);

    WALKER_CREDENTIALS[e] = { ...cred, mustSetPin: false };
    if (onSetPassword) onSetPassword(e);
    try { localStorage.setItem(STORAGE_KEY, e); } catch {}
    const walkerData = getAllWalkers().find(w => w.id === cred?.walkerId);
    onLogin({ ...walkerData, email: e, role: "walker" });
  };

  const handleForgot = async () => {
    if (isLoading) return;
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { setFormError("Go back and enter your email first."); return; }
    setIsLoading(true); setFormError("");
    await authSendPasswordReset(e);   // Supabase sends the reset link
    setIsLoading(false);
    setStage("forgot-sent");
  };

  const handleForgetMe = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setSavedEmail(null); setEmail(""); setPassword(""); setConfirmPw("");
    setStage("entry");
  };


  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100svh",
      background: "linear-gradient(135deg,#112830 0%,#1A3A42 50%,#112830 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "clamp(20px,5vw,48px) 16px" }}>
      <style>{GLOBAL_STYLES}</style>

      {/* Header */}
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

        {/* ── Entry: email ── */}
        {stage === "entry" && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
              fontSize: "15px", textAlign: "center", marginBottom: "24px" }}>
              Enter your walker email to continue.
            </div>
            <input type="email" placeholder="you@lonestarbark.com" value={email}
              onChange={e => { setEmail(e.target.value); setEmailError(""); }}
              onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
              style={inputStyle(!!emailError)} />
            {emailError && <div style={errStyle}>{emailError}</div>}
            <button onClick={handleEmailSubmit} style={btnPrimary(accentBlue, false)}>
              Continue →
            </button>
          </div>
        )}

        {/* ── Password: log in ── */}
        {stage === "password" && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              {savedEmail ? (
                <>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
                    fontSize: "15px", marginBottom: "6px" }}>Welcome back!</div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "8px",
                    background: "rgba(42,74,127,0.3)", borderRadius: "20px",
                    padding: "5px 12px 5px 10px" }}>
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
                    fontSize: "15px" }}>{email.trim().toLowerCase()}</div>
                </>
              )}
            </div>

            <PasswordField value={password} onChange={v => { setPassword(v); setFormError(""); }}
              label="Password" onEnter={handleLogin}
              showPw={showPw} onToggleShowPw={() => setShowPw(s => !s)} hasError={!!formError} />
            {formError && <div style={errStyle}>{formError}</div>}

            <button onClick={handleLogin} disabled={isLoading}
              style={{ ...btnPrimary(accentBlue, isLoading), marginTop: "4px" }}>
              {isLoading ? "Signing in…" : "Sign In →"}
            </button>

            <button onClick={handleForgetMe} style={btnGhost}>
              {savedEmail ? "← Not you? Switch account" : "← Use a different email"}
            </button>
            <button onClick={() => { setPassword(""); setFormError(""); setStage("forgot"); }}
              style={{ ...btnGhost, color: accentBlue, textDecoration: "underline", marginTop: "6px" }}>
              Forgot password?
            </button>
          </div>
        )}

        {/* ── Set password: first login ── */}
        {stage === "setpassword" && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>🔐</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                fontSize: "16px", fontWeight: 700, marginBottom: "6px" }}>
                Set Your Password
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#4E7A8C", fontSize: "14px", lineHeight: "1.6" }}>
                Welcome to Lonestar Bark Co.! Choose a password you'll use to log in. At least 8 characters.
              </div>
            </div>

            <PasswordField value={password} onChange={v => { setPassword(v); setFormError(""); }}
              label="New password"
              showPw={showPw} onToggleShowPw={() => setShowPw(s => !s)} hasError={!!formError} />
            <PasswordField value={confirmPw} onChange={v => { setConfirmPw(v); setFormError(""); }}
              label="Confirm password" onEnter={handleSetPassword}
              showPw={showPw} onToggleShowPw={() => setShowPw(s => !s)} hasError={!!formError} />
            {formError && <div style={errStyle}>{formError}</div>}

            <button onClick={handleSetPassword} disabled={isLoading}
              style={btnPrimary(accentBlue, isLoading)}>
              {isLoading ? "Saving…" : "Set Password & Sign In →"}
            </button>
            <button onClick={handleForgetMe} style={btnGhost}>← Use a different email</button>
          </div>
        )}

        {/* ── Forgot password ── */}
        {stage === "forgot" && (
          <div className="fade-up" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔑</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>Reset Your Password</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "14px", lineHeight: "1.6", marginBottom: "24px" }}>
              We'll email a reset link to <strong style={{ color: "#fff" }}>{email.trim().toLowerCase()}</strong>.
            </div>
            {formError && <div style={errStyle}>{formError}</div>}
            <button onClick={handleForgot} disabled={isLoading}
              style={btnPrimary(accentBlue, isLoading)}>
              {isLoading ? "Sending…" : "Send Reset Link"}
            </button>
            <button onClick={() => { setFormError(""); setStage("password"); }} style={btnGhost}>
              ← Back to login
            </button>
          </div>
        )}

        {/* ── Forgot sent confirmation ── */}
        {stage === "forgot-sent" && (
          <div className="fade-up" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📬</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>Check Your Email</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "14px", lineHeight: "1.7", marginBottom: "24px" }}>
              If <strong style={{ color: "#fff" }}>{email.trim().toLowerCase()}</strong> has a walker
              account, you'll get a reset link shortly. Click it to set a new password.
            </div>
            <button onClick={() => setStage("password")} style={btnPrimary(accentBlue, false)}>
              ← Back to login
            </button>
          </div>
        )}

      </div>

      {/* Footer nav */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginTop: "20px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none",
          color: "#ffffffaa", fontFamily: "'DM Sans', sans-serif", fontSize: "15px", cursor: "pointer" }}>
          ← Back to portal selector
        </button>
        <button onClick={onBackToLanding} style={{ background: "none", border: "none",
          color: "#ffffff55", fontFamily: "'DM Sans', sans-serif", fontSize: "14px", cursor: "pointer" }}>
          ← Back to homepage
        </button>
      </div>
    </div>
  );
}

export { getAllWalkers, injectCustomWalkers, WALKER_CREDENTIALS, CUSTOM_WALKERS };
export default WalkerAuthScreen;
