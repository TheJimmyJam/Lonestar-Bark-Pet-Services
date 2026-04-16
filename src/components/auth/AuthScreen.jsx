import { useState, useRef, useEffect } from "react";
import LogoBadge from "../shared/LogoBadge.jsx";
import { GLOBAL_STYLES } from "../../styles.js";
import {
  authSignUpWithEmail,
  authSignInWithEmail,
  authSendPasswordReset,
} from "../../supabase.js";

// ─── Client Auth Screen (Supabase Auth) ───────────────────────────────────────
// Clients authenticate with email + password or Google OAuth. Staff (admins,
// walkers) still use PIN-based auth via their own screens.
//
// Stages:
//   "login"        → email + password + Google + "Sign up" + "Forgot password"
//   "signup"       → email + password + confirm + Google + "Log in"
//   "register-name"→ after a successful email signup, collect name/pets
//   "forgot"       → enter email, send reset link, show "check your email"
function AuthScreen({ onRegister, onBack, onBackToLanding, pendingRegistration, clearPendingRegistration }) {
  // If we arrived here with a Supabase Auth session but no matching client
  // row (fresh Google signup), App.jsx passes `pendingRegistration` with the
  // auth user so we can skip straight to the name/pets form.
  const [stage, setStage] = useState(() => (pendingRegistration ? "register-name" : "login"));

  // Auth form state
  const [email, setEmail] = useState(pendingRegistration?.email || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Register-name stage state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dogs, setDogs] = useState([""]);
  const [cats, setCats] = useState([""]);

  const formRef = useRef(null);

  useEffect(() => {
    if (stage === "register-name") {
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
  }, [stage]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    setFormError("");
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { setFormError("Enter a valid email address."); return; }
    if (!password) { setFormError("Enter your password."); return; }
    setSubmitting(true);
    const { error } = await authSignInWithEmail({ email: e, password });
    setSubmitting(false);
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("email not confirmed")) {
        setFormError("Please verify your email first — check your inbox for the confirmation link.");
      } else if (msg.includes("invalid login")) {
        setFormError("Wrong email or password.");
      } else {
        setFormError(error.message || "Login failed. Try again.");
      }
      return;
    }
    // App.jsx's onAuthStateChange listener will pick up the session and route.
  };

  const handleSignup = async () => {
    setFormError("");
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { setFormError("Enter a valid email address."); return; }
    if (!password || password.length < 8) { setFormError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setFormError("Passwords don't match."); return; }
    setSubmitting(true);
    const { data, error } = await authSignUpWithEmail({ email: e, password });
    setSubmitting(false);
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already registered") || msg.includes("user already")) {
        setFormError("That email is already registered. Try logging in instead.");
      } else {
        setFormError(error.message || "Signup failed. Try again.");
      }
      return;
    }
    // If email confirmation is required, `data.session` will be null.
    if (!data?.session) {
      setNotice(`Check your inbox — we sent a confirmation link to ${e}. Click it to activate your account.`);
      setStage("login");
      setPassword("");
      setConfirmPassword("");
      return;
    }
    // Otherwise session exists immediately → move to name/pets form.
    setStage("register-name");
  };

  const handleForgot = async () => {
    setFormError("");
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { setFormError("Enter a valid email address."); return; }
    setSubmitting(true);
    const { error } = await authSendPasswordReset(e);
    setSubmitting(false);
    if (error) { setFormError(error.message || "Couldn't send reset email."); return; }
    setNotice(`Reset link sent to ${e}. Check your inbox.`);
    setStage("login");
  };

  // ── Register-name stage ─────────────────────────────────────────────────────
  const validDogs = dogs.map(d => d.trim()).filter(Boolean);
  const validCats = cats.map(c => c.trim()).filter(Boolean);
  const canSubmitName = firstName.trim() && lastName.trim() && (validDogs.length > 0 || validCats.length > 0);

  const handleFinishRegister = () => {
    if (!canSubmitName) return;
    // onRegister in App.jsx creates the clients row linked to user_id.
    // `pendingRegistration` is passed in when this came from a Google OAuth
    // new-user flow; otherwise the current Supabase session is used.
    const profile = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      dogs: validDogs,
      cats: validCats,
    };
    onRegister(profile, pendingRegistration || null);
    if (clearPendingRegistration) clearPendingRegistration();
  };

  // ── Shared styles ───────────────────────────────────────────────────────────
  const inputStyle = {
    width: "100%", padding: "14px 16px", borderRadius: "12px",
    border: "1.5px solid #4A2E18", background: "#0B1423", color: "#fff",
    fontSize: "16px", fontFamily: "'DM Sans', sans-serif",
    boxSizing: "border-box", outline: "none",
  };
  const labelStyle = {
    display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
    fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase",
    color: "#ffffffaa", marginBottom: "6px",
  };
  const primaryBtn = {
    width: "100%", padding: "14px", borderRadius: "12px", border: "none",
    background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
    fontSize: "16px", fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer",
    opacity: submitting ? 0.7 : 1, letterSpacing: "0.3px",
  };
  const secondaryLink = {
    background: "none", border: "none", color: "#C4541A",
    fontFamily: "'DM Sans', sans-serif", fontSize: "14px", cursor: "pointer",
    textDecoration: "underline", padding: 0,
  };
  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100svh",
      background: "linear-gradient(135deg,#0a1220 0%,#0B1423 50%,#0a1220 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "clamp(12px, 3vw, 28px) 16px",
    }}>
      <style>{GLOBAL_STYLES}</style>

      <div style={{ textAlign: "center", marginBottom: "20px" }}>
        <LogoBadge size={60} />
        <div style={{
          fontFamily: "'DM Sans', sans-serif", color: "#fff",
          fontSize: "15px", textTransform: "uppercase", fontWeight: 600,
          letterSpacing: "2px", marginBottom: "6px", marginTop: "10px",
        }}>
          Lonestar Bark Co.
        </div>
        <div style={{
          fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
          fontSize: "13px", letterSpacing: "3px", textTransform: "uppercase",
        }}>
          Client Portal
        </div>
      </div>

      <div className="auth-card fade-up" style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "24px", padding: "28px 28px 24px",
        width: "100%", maxWidth: "420px",
      }}>

        {/* Notice banner (e.g. "check your email") */}
        {notice && (
          <div style={{
            background: "rgba(196, 84, 26, 0.12)",
            border: "1px solid rgba(196, 84, 26, 0.35)",
            borderRadius: "10px", padding: "12px 14px", marginBottom: "18px",
            fontFamily: "'DM Sans', sans-serif", color: "#f3d5bd",
            fontSize: "14px", lineHeight: "1.5",
          }}>
            {notice}
          </div>
        )}

        {/* ─── LOGIN ─────────────────────────────────────────────────────── */}
        {stage === "login" && (
          <>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "20px", fontWeight: 700, marginBottom: "4px",
              textAlign: "center",
            }}>
              Welcome back
            </div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "14px", marginBottom: "22px", textAlign: "center",
            }}>
              Sign in to manage your walks.
            </div>

            <label style={labelStyle}>Email</label>
            <input
              type="email" placeholder="your@email.com" value={email}
              onChange={e => { setEmail(e.target.value); setFormError(""); }}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              style={{ ...inputStyle, marginBottom: "14px" }}
            />

            <label style={labelStyle}>Password</label>
            <div style={{ position: "relative", marginBottom: "6px" }}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••" value={password}
                onChange={e => { setPassword(e.target.value); setFormError(""); }}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{ ...inputStyle, paddingRight: "60px" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                style={{
                  position: "absolute", right: "10px", top: "50%",
                  transform: "translateY(-50%)", background: "none",
                  border: "none", color: "#ffffff88", fontSize: "12px",
                  cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            <div style={{
              marginTop: "14px", marginBottom: "10px", textAlign: "center",
              fontFamily: "'DM Sans', sans-serif", color: "#ffffffcc",
              fontSize: "15px", fontWeight: 500,
            }}>
              Don't have an account?{" "}
              <button onClick={() => { setFormError(""); setNotice(""); setPassword(""); setStage("signup"); }}
                style={{
                  background: "none", border: "none", color: "#D4A843",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 700, cursor: "pointer",
                  textDecoration: "underline", padding: 0,
                }}>
                Sign up
              </button>
            </div>

            <div style={{ textAlign: "right", marginBottom: "14px" }}>
              <button onClick={() => { setFormError(""); setNotice(""); setStage("forgot"); }}
                style={secondaryLink}>
                Forgot password?
              </button>
            </div>

            {formError && (
              <div style={{
                color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px", marginBottom: "12px",
              }}>{formError}</div>
            )}

            <button onClick={handleLogin} disabled={submitting} style={primaryBtn}>
              {submitting ? "Signing in…" : "Log in"}
            </button>
          </>
        )}

        {/* ─── SIGNUP ────────────────────────────────────────────────────── */}
        {stage === "signup" && (
          <>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "20px", fontWeight: 700, marginBottom: "4px",
              textAlign: "center",
            }}>
              Create your account
            </div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "14px", marginBottom: "22px", textAlign: "center",
            }}>
              Takes less than a minute.
            </div>

            <label style={labelStyle}>Email</label>
            <input
              type="email" placeholder="your@email.com" value={email}
              onChange={e => { setEmail(e.target.value); setFormError(""); }}
              style={{ ...inputStyle, marginBottom: "14px" }}
            />

            <label style={labelStyle}>Password</label>
            <input
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters" value={password}
              onChange={e => { setPassword(e.target.value); setFormError(""); }}
              style={{ ...inputStyle, marginBottom: "14px" }}
            />

            <label style={labelStyle}>Confirm Password</label>
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Type it again" value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setFormError(""); }}
              onKeyDown={e => e.key === "Enter" && handleSignup()}
              style={{ ...inputStyle, marginBottom: "10px" }}
            />

            <div style={{ marginBottom: "14px" }}>
              <label style={{
                display: "flex", alignItems: "center", gap: "8px",
                fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
                fontSize: "13px", cursor: "pointer",
              }}>
                <input type="checkbox" checked={showPassword}
                  onChange={e => setShowPassword(e.target.checked)} />
                Show password
              </label>
            </div>

            {formError && (
              <div style={{
                color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px", marginBottom: "12px",
              }}>{formError}</div>
            )}

            <button onClick={handleSignup} disabled={submitting} style={primaryBtn}>
              {submitting ? "Creating account…" : "Sign up"}
            </button>

            <div style={{
              marginTop: "22px", textAlign: "center",
              fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa", fontSize: "14px",
            }}>
              Already have an account?{" "}
              <button onClick={() => { setFormError(""); setNotice(""); setPassword(""); setConfirmPassword(""); setStage("login"); }}
                style={secondaryLink}>
                Log in
              </button>
            </div>
          </>
        )}

        {/* ─── FORGOT PASSWORD ───────────────────────────────────────────── */}
        {stage === "forgot" && (
          <>
            <div style={{ fontSize: "32px", marginBottom: "12px", textAlign: "center" }}>🔑</div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "20px", fontWeight: 700, marginBottom: "6px",
              textAlign: "center",
            }}>
              Reset your password
            </div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "14px", lineHeight: "1.6", marginBottom: "22px",
              textAlign: "center",
            }}>
              Enter your email and we'll send you a reset link.
            </div>

            <label style={labelStyle}>Email</label>
            <input
              type="email" placeholder="your@email.com" value={email}
              onChange={e => { setEmail(e.target.value); setFormError(""); }}
              onKeyDown={e => e.key === "Enter" && handleForgot()}
              style={{ ...inputStyle, marginBottom: "14px" }}
            />

            {formError && (
              <div style={{
                color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px", marginBottom: "12px",
              }}>{formError}</div>
            )}

            <button onClick={handleForgot} disabled={submitting} style={primaryBtn}>
              {submitting ? "Sending…" : "Send reset link"}
            </button>

            <div style={{ textAlign: "center", marginTop: "16px" }}>
              <button onClick={() => { setFormError(""); setStage("login"); }} style={secondaryLink}>
                Back to login
              </button>
            </div>
          </>
        )}

        {/* ─── REGISTER NAME / PETS ──────────────────────────────────────── */}
        {stage === "register-name" && (
          <div ref={formRef} style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: "4px" }}>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "20px", fontWeight: 700, marginBottom: "6px",
              textAlign: "center",
            }}>
              Almost done!
            </div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "14px", textAlign: "center", marginBottom: "22px",
            }}>
              Tell us about you and your pets.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "18px" }}>
              <div>
                <label style={labelStyle}>First Name</label>
                <input type="text" placeholder="First name" value={firstName}
                  onChange={e => setFirstName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Last Name</label>
                <input type="text" placeholder="Last name" value={lastName}
                  onChange={e => setLastName(e.target.value)} style={inputStyle} />
              </div>
            </div>

            {/* Dogs */}
            <div style={{ marginBottom: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Dogs <span style={{ fontWeight: 400, color: "#ffffff55", textTransform: "none", letterSpacing: "0", fontSize: "13px" }}>(optional)</span>
                </label>
                <button onClick={() => setDogs(d => [...d, ""])} style={{
                  background: "none", border: "1px solid #4A2E18", color: "#D4A843",
                  borderRadius: "6px", padding: "3px 10px", cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 500,
                }}>+ Add Dog</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {dogs.map((dog, i) => (
                  <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input type="text" placeholder={i === 0 ? "Dog's name" : `Dog ${i + 1}'s name`} value={dog}
                      onChange={e => setDogs(d => d.map((v, j) => j === i ? e.target.value : v))}
                      style={{ ...inputStyle, flex: 1 }} />
                    {dogs.length > 1 && (
                      <button onClick={() => setDogs(d => d.filter((_, j) => j !== i))} style={{
                        background: "none", border: "1px solid #4A2E18", color: "#6b7280",
                        borderRadius: "6px", padding: "8px 10px", cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "14px", flexShrink: 0,
                      }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Cats */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Cats <span style={{ fontWeight: 400, color: "#ffffff55", textTransform: "none", letterSpacing: "0", fontSize: "13px" }}>(optional)</span>
                </label>
                <button onClick={() => setCats(c => [...c, ""])} style={{
                  background: "none", border: "1px solid #4A2E18", color: "#D4A843",
                  borderRadius: "6px", padding: "3px 10px", cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 500,
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
                      fontFamily: "'DM Sans', sans-serif", fontSize: "14px", flexShrink: 0,
                    }}>✕</button>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={handleFinishRegister} disabled={!canSubmitName} style={{
              ...primaryBtn,
              background: canSubmitName ? "#C4541A" : "#1e3550",
              color: canSubmitName ? "#fff" : "#ffffff55",
              cursor: canSubmitName ? "pointer" : "default",
            }}>
              Create Account →
            </button>
            {!canSubmitName && firstName.trim() && lastName.trim() && (
              <div style={{
                fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                color: "#ffffffaa", textAlign: "center", marginTop: "8px",
              }}>
                Add at least one pet name to continue.
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginTop: "20px" }}>
        {onBack && stage !== "register-name" && (
          <button onClick={onBack} style={{
            background: "none", border: "none",
            color: "#ffffffaa", fontFamily: "'DM Sans', sans-serif",
            fontSize: "14px", cursor: "pointer", letterSpacing: "0.3px",
          }}>
            ← Back to portal selector
          </button>
        )}
        <button onClick={onBackToLanding} style={{
          background: "none", border: "none",
          color: "#ffffff55", fontFamily: "'DM Sans', sans-serif",
          fontSize: "13px", cursor: "pointer", letterSpacing: "0.3px",
        }}>
          ← Back to homepage
        </button>
      </div>
    </div>
  );
}

export default AuthScreen;
