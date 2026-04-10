import { useState, useEffect, useRef } from "react";
import { SERVICES } from "../../constants.js";
import { notifyAdmin } from "../../supabase.js";
import { addrToString, emptyAddr, firstName, formatPhone, generateCode } from "../../helpers.js";
import PinPad from "../shared/PinPad.jsx";
import LogoBadge from "../shared/LogoBadge.jsx";
import AddressFields from "../shared/AddressFields.jsx";
import { GLOBAL_STYLES } from "../../styles.js";
import useRateLimiter from "../../hooks/useRateLimiter.js";

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ clients, onLogin, onRegister, onBack, onBackToLanding, onSetPin, onRequestPinReset, onVerifyPinReset }) {
  // stage: "entry" | "login-pin" | "register-pin" | "register-name" | "setpin" | "confirmpin" | "forgot-email" | "forgot-code"
  const savedEmail = (() => { try { return localStorage.getItem("dwi_saved_email") || ""; } catch { return ""; } })();
  const [stage, setStage] = useState(() => {
    if (savedEmail) {
      const existing = Object.values(clients).find(c => c.email === savedEmail);
      if (existing) return existing.mustSetPin ? "setpin" : "login-pin";
    }
    return "entry";
  });
  const [email, setEmail] = useState(savedEmail);
  const [emailError, setEmailError] = useState("");
  const [pinError, setPinError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dogs, setDogs] = useState([""]);
  const [cats, setCats] = useState([""]);
  
  const [pendingPin, setPendingPin] = useState("");
  const [newClientPin, setNewClientPin] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetEmailError, setResetEmailError] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetCodeError, setResetCodeError] = useState("");
  const [resetSending, setResetSending] = useState(false);
  const rateLimiter = useRateLimiter(email);

  const pinSectionRef  = useRef(null);
  const nameSectionRef = useRef(null);

  // Scroll to PIN pad when stage changes to login-pin or register-pin
  useEffect(() => {
    if (stage === "login-pin" || stage === "register-pin" || stage === "setpin" || stage === "confirmpin") {
      setTimeout(() => pinSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
    if (stage === "register-name") {
      setTimeout(() => nameSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }, [stage]);

  const handleEmailSubmit = () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { setEmailError("Please enter a valid email address."); return; }
    setEmailError("");
    const existing = Object.values(clients).find(c => c.email === e);
    if (existing) {
      setIsNew(false);
      setStage(existing.mustSetPin ? "setpin" : "login-pin");
    }
    else { setIsNew(true); setStage("register-pin"); }
  };

  const handleLoginPin = (pin) => {
    if (rateLimiter.locked) return;
    const client = Object.values(clients).find(c => c.email === email.trim().toLowerCase());
    if (client && client.pin === pin) {
      if (client.emailVerified === false) {
        setPinError("Please verify your email before logging in. Check your inbox for the verification link.");
        return;
      }
      rateLimiter.clearFailures();
      try { localStorage.setItem("dwi_saved_email", email.trim().toLowerCase()); } catch {}
      onLogin(client);
    }
    else {
      const nowLocked = rateLimiter.recordFailure();
      if (nowLocked) {
        setPinError("Too many failed attempts. Account locked."); setTimeout(() => setPinError(""), 100);
      } else {
        setPinError(`Incorrect PIN. ${rateLimiter.attemptsLeft - 1} attempt${rateLimiter.attemptsLeft - 1 === 1 ? "" : "s"} remaining.`);
        setTimeout(() => setPinError(""), 100);
      }
    }
  };

  const handleSetClientPin = (pin) => {
    if (!newClientPin) {
      setNewClientPin(pin);
      setStage("confirmpin");
      return;
    }
    if (pin !== newClientPin) {
      setPinError("PINs don't match — try again."); setTimeout(() => setPinError(""), 100);
      setNewClientPin(null); setStage("setpin"); return;
    }
    const client = Object.values(clients).find(c => c.email === email.trim().toLowerCase());
    if (client && onSetPin) onSetPin(client.id, pin);
    try { localStorage.setItem("dwi_saved_email", email.trim().toLowerCase()); } catch {}
    onLogin({ ...client, pin, mustSetPin: false });
  };

  const forgetSavedEmail = () => {
    try { localStorage.removeItem("dwi_saved_email"); } catch {}
    setEmail(""); setStage("entry"); setPinError(""); setNewClientPin(null);
  };

  const handleRegisterPin = (pin) => {
    setPendingPin(pin);
    setStage("register-name");
  };

  const validDogs = dogs.map(d => d.trim()).filter(Boolean);
  const validCats = cats.map(c => c.trim()).filter(Boolean);
  const canSubmit = firstName.trim() && lastName.trim() && (validDogs.length > 0 || validCats.length > 0);

  const handleFinishRegister = () => {
    if (!canSubmit) return;
    const newClient = {
      id: `c_${Date.now()}`,
      email: email.trim().toLowerCase(),
      pin: pendingPin,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      dogs: validDogs,
      cats: validCats,
      walkSchedule: null,
      preferredDuration: null,
      handoffDone: false,
      bookings: [],
      createdAt: new Date().toISOString(),
      emailVerified: false,
    };
    onRegister(newClient);
  };

  const inputStyle = {
    width: "100%", padding: "12px 14px", borderRadius: "10px",
    border: "1.5px solid #4A2E18", background: "#0B1423", color: "#fff",
    fontSize: "16px", fontFamily: "'DM Sans', sans-serif",
  };

  const labelStyle = {
    display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
    fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase",
    color: "#ffffffaa", marginBottom: "6px",
  };

  

  return (
    <div style={{ minHeight: "100svh", background: "linear-gradient(135deg,#0a1220 0%,#0B1423 50%,#0a1220 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "clamp(12px, 3vw, 28px) 16px" }}>
      <style>{GLOBAL_STYLES}</style>

      <div style={{ textAlign: "center", marginBottom: "20px" }}>
        <LogoBadge size={60} />
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
          fontSize: "15px", textTransform: "uppercase", fontWeight: 600, letterSpacing: "2px", marginBottom: "6px" }}>
          Lonestar Bark Co.
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
          fontSize: "15px", letterSpacing: "3px", textTransform: "uppercase" }}>
          Client Portal
        </div>
      </div>

      <div className="auth-card" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "24px", padding: "24px 28px" }}>

        {/* Email entry */}
        {stage === "entry" && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb", fontSize: "15px",
              textAlign: "center", marginBottom: "24px", lineHeight: "1.6" }}>
              Enter your email to log in or create an account.
            </div>
            <input
              type="email" placeholder="your@email.com" value={email}
              onChange={e => { setEmail(e.target.value); setEmailError(""); }}
              onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
              style={{
                width: "100%", padding: "14px 16px", borderRadius: "12px",
                border: emailError ? "1.5px solid #ef4444" : "1.5px solid #4A2E18",
                background: "#0B1423", color: "#fff", fontSize: "15px",
                fontFamily: "'DM Sans', sans-serif", marginBottom: "12px",
              }} />
            {emailError && <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", marginBottom: "10px" }}>{emailError}</div>}
            <button onClick={handleEmailSubmit} style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
            }}>Continue →</button>
          </div>
        )}

        {/* Login with PIN */}
        {stage === "login-pin" && (
          <div ref={pinSectionRef} className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "8px" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb", fontSize: "15px",
                marginBottom: "6px" }}>Welcome back!</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px",
                background: "rgba(255,255,255,0.08)", borderRadius: "20px",
                padding: "6px 14px", marginBottom: "4px" }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffcc", fontSize: "15px" }}>
                  {email.trim().toLowerCase()}
                </span>
                <button onClick={forgetSavedEmail} style={{ background: "none", border: "none",
                  color: "#ffffff55", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "15px", padding: 0, lineHeight: 1 }}>✕</button>
              </div>
            </div>
            <div style={{ marginTop: "12px" }}>
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
                <PinPad label="Enter your PIN" onComplete={handleLoginPin}
                  error={pinError} color="#C4541A" />
              )}
            </div>
            <button onClick={() => { forgetSavedEmail(); }}
              style={{ marginTop: "12px", background: "none", border: "none", color: "#ffffffaa",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px", cursor: "pointer",
                width: "100%", textAlign: "center" }}>
              Not you? Use a different account
            </button>
            <button onClick={() => { setResetEmail(email); setResetEmailError(""); setStage("forgot-email"); }}
              style={{ marginTop: "6px", background: "none", border: "none", color: "#C4541A",
                fontFamily: "'DM Sans', sans-serif", fontSize: "13px", cursor: "pointer",
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
              Enter your email and we'll send you a 6-digit reset code.
            </div>
            <input
              type="email"
              value={resetEmail}
              onChange={e => { setResetEmail(e.target.value); setResetEmailError(""); }}
              placeholder="your@email.com"
              style={{ width: "100%", padding: "12px 16px", borderRadius: "10px", border: resetEmailError ? "1.5px solid #ef4444" : "1.5px solid #444",
                background: "rgba(255,255,255,0.08)", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", boxSizing: "border-box", marginBottom: "8px", outline: "none" }}
            />
            {resetEmailError && <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "8px" }}>{resetEmailError}</div>}
            <button
              disabled={resetSending}
              onClick={async () => {
                if (!resetEmail.trim()) { setResetEmailError("Enter your email."); return; }
                setResetSending(true);
                const ok = await onRequestPinReset(resetEmail.trim().toLowerCase());
                setResetSending(false);
                if (!ok) { setResetEmailError("No account found with that email."); return; }
                setResetCodeError(""); setResetCode(""); setStage("forgot-code");
              }}
              style={{ width: "100%", padding: "13px", background: "#C4541A", color: "#fff",
                border: "none", borderRadius: "10px", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 700, cursor: resetSending ? "not-allowed" : "pointer",
                opacity: resetSending ? 0.7 : 1, marginBottom: "12px" }}>
              {resetSending ? "Sending…" : "Send Reset Code"}
            </button>
            <button onClick={() => setStage("login-pin")}
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
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={resetCode}
              onChange={e => { setResetCode(e.target.value.replace(/\D/g, "")); setResetCodeError(""); }}
              placeholder="000000"
              style={{ width: "100%", padding: "14px 16px", borderRadius: "10px",
                border: resetCodeError ? "1.5px solid #ef4444" : "1.5px solid #444",
                background: "rgba(255,255,255,0.08)", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "28px", fontWeight: 700, letterSpacing: "8px", textAlign: "center",
                boxSizing: "border-box", marginBottom: "8px", outline: "none" }}
            />
            {resetCodeError && <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "8px" }}>{resetCodeError}</div>}
            <button
              onClick={() => {
                if (resetCode.length !== 6) { setResetCodeError("Enter the 6-digit code from your email."); return; }
                const valid = onVerifyPinReset(resetEmail, resetCode);
                if (!valid) { setResetCodeError("Invalid or expired code. Try again."); return; }
                const client = Object.values(clients).find(c => c.email?.toLowerCase() === resetEmail.toLowerCase());
                if (client) { setEmail(client.email); }
                setNewClientPin(null); setStage("setpin");
              }}
              style={{ width: "100%", padding: "13px", background: "#C4541A", color: "#fff",
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

        {/* First-login PIN setup (walker/admin added this client) */}
        {(stage === "setpin" || stage === "confirmpin") && (
          <div ref={pinSectionRef} className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>🔐</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, marginBottom: "6px" }}>
                {stage === "setpin" ? "Set Your PIN" : "Confirm Your PIN"}
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#D4A880",
                fontSize: "16px", lineHeight: "1.6" }}>
                {stage === "setpin"
                  ? "Welcome! Choose a 6-digit PIN — you'll use it every time you log in."
                  : "Enter your new PIN one more time to confirm."}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px",
                background: "rgba(255,255,255,0.08)", borderRadius: "20px",
                padding: "6px 14px", marginTop: "10px" }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffcc", fontSize: "16px" }}>
                  {email.trim().toLowerCase()}
                </span>
              </div>
            </div>
            <PinPad
              label={stage === "setpin" ? "Choose a 6-digit PIN" : "Confirm PIN"}
              onComplete={handleSetClientPin}
              error={pinError}
              color="#C4541A"
            />
            <button onClick={forgetSavedEmail}
              style={{ marginTop: "20px", background: "none", border: "none", color: "#ffffffaa",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer",
                width: "100%", textAlign: "center" }}>
              ← Use a different account
            </button>
          </div>
        )}

        {/* New account — set PIN */}
        {stage === "register-pin" && (
          <div ref={pinSectionRef} className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "8px" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb", fontSize: "15px",
                marginBottom: "4px" }}>Create your account</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa", fontSize: "16px" }}>
                {email.trim().toLowerCase()}
              </div>
            </div>
            <div style={{ marginTop: "24px" }}>
              <PinPad label="Choose a 6-digit PIN" onComplete={handleRegisterPin} color="#C4541A" />
            </div>
            <button onClick={() => setStage("entry")}
              style={{ marginTop: "20px", background: "none", border: "none", color: "#ffffffaa",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer",
                width: "100%", textAlign: "center" }}>
              ← Back
            </button>
          </div>
        )}

        {/* New account — name + pets + schedule */}
        {stage === "register-name" && (
          <div ref={nameSectionRef} className="fade-up" style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: "4px" }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb", fontSize: "15px",
              textAlign: "center", marginBottom: "24px" }}>
              Almost done! Tell us about yourself and your pets.
            </div>

            {/* First & Last Name */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
              <div>
                <label style={labelStyle}>First Name</label>
                <input type="text" placeholder="First name" value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Last Name</label>
                <input type="text" placeholder="Last name" value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  style={inputStyle} />
              </div>
            </div>

            {/* Dogs — mandatory */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Dogs <span style={{ fontWeight: 400, color: "#1a2d45", textTransform: "none",
                    letterSpacing: "0", fontSize: "15px" }}>(optional)</span>
                </label>
                <button onClick={() => setDogs(d => [...d, ""])} style={{
                  background: "none", border: "1px solid #4A2E18", color: "#D4A843",
                  borderRadius: "6px", padding: "3px 10px", cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 500,
                }}>+ Add Dog</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {dogs.map((dog, i) => (
                  <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input type="text" placeholder={i === 0 ? "Dog's name" : `Dog ${i + 1}'s name`} value={dog}
                      onChange={e => setDogs(d => d.map((v, j) => j === i ? e.target.value : v))}
                      style={{
                        ...inputStyle,
                        flex: 1,
                      }} />
                    {dogs.length > 1 && (
                      <button onClick={() => setDogs(d => d.filter((_, j) => j !== i))} style={{
                        background: "none", border: "1px solid #4A2E18", color: "#6b7280",
                        borderRadius: "6px", padding: "8px 10px", cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px", flexShrink: 0,
                      }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Cats — optional */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Cats <span style={{ fontWeight: 400, color: "#1a2d45", textTransform: "none",
                    letterSpacing: "0", fontSize: "15px" }}>(optional)</span>
                </label>
                <button onClick={() => setCats(c => [...c, ""])} style={{
                  background: "none", border: "1px solid #4A2E18", color: "#D4A843",
                  borderRadius: "6px", padding: "3px 10px", cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 500,
                }}>+ Add Cat</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {cats.map((cat, i) => (
                  <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input type="text" placeholder={i === 0 ? "Cat's name" : `Cat ${i + 1}'s name`} value={cat}
                      onChange={e => setCats(c => c.map((v, j) => j === i ? e.target.value : v))}
                      style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={() => setCats(c => c.filter((_, j) => j !== i))} style={{
                      background: "none", border: "1px solid #4A2E18", color: "#6b7280",
                      borderRadius: "6px", padding: "8px 10px", cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "15px", flexShrink: 0,
                    }}>✕</button>
                  </div>
                ))}
                {cats.length === 0 && (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#1a2d45", fontStyle: "italic" }}>No cats added yet.</div>
                )}
              </div>
            </div>

            <button onClick={handleFinishRegister} disabled={!canSubmit} style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: canSubmit ? "#C4541A" : "#1e3550",
              color: canSubmit ? "#fff" : "#ffffff55",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              fontWeight: 500, cursor: canSubmit ? "pointer" : "default", letterSpacing: "0.3px",
            }}>Create Account →</button>
            {!canSubmit && firstName.trim() && lastName.trim() && (
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#ffffffaa", textAlign: "center", marginTop: "8px" }}>
                Add at least one pet name to continue.
              </div>
            )}
          </div>
        )}
      </div>

      {onBack && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginTop: "20px" }}>
          <button onClick={onBack} style={{
            background: "none", border: "none",
            color: "#ffffffaa", fontFamily: "'DM Sans', sans-serif",
            fontSize: "16px", cursor: "pointer", letterSpacing: "0.3px",
          }}>
            ← Back to portal selector
          </button>
          <button onClick={onBackToLanding} style={{
            background: "none", border: "none",
            color: "#ffffff55", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", cursor: "pointer", letterSpacing: "0.3px",
          }}>
            ← Back to homepage
          </button>
        </div>
      )}
    </div>
  );
}


export default AuthScreen;
