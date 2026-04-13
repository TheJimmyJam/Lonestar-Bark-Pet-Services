import { useState, useEffect } from "react";
import { supabase, saveAdminList } from "../../supabase.js";
import LogoBadge from "../shared/LogoBadge.jsx";
import { GLOBAL_STYLES } from "../../styles.js";

// ─── Admin Auth Screen ────────────────────────────────────────────────────────
function AdminAuthScreen({ onLogin, onBack, onBackToLanding, adminList, setAdminList }) {
  const STORAGE_KEY = "dw_admin_email";
  const amber = "#b45309";

  const [stage, setStage]       = useState("entry"); // "entry" | "password" | "forgot-sent"
  const [email, setEmail]       = useState("");
  const [savedEmail, setSavedEmail] = useState(null);
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const found = adminList.find(a => a.email.toLowerCase() === stored.toLowerCase() && a.status === "active");
        if (found) { setSavedEmail(stored); setEmail(stored); setStage("password"); }
      }
    } catch {}
  }, []);

  const handleEmailSubmit = () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) { setEmailError("Enter a valid email."); return; }
    const found = adminList.find(a => a.email.toLowerCase() === e);
    if (!found) { setEmailError("No admin account found for this email."); return; }
    if (found.status === "invited") {
      setEmailError("Your invite is pending — check your email for a setup link.");
      return;
    }
    setEmailError("");
    setStage("password");
  };

  const handlePasswordSubmit = async () => {
    if (!password) { setPasswordError("Enter your password."); return; }
    setLoading(true);
    setPasswordError("");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: (savedEmail || email).trim().toLowerCase(),
        password,
      });
      if (error) {
        setPasswordError(
          error.message.includes("Invalid login")
            ? "Incorrect password. Try again."
            : error.message
        );
        setLoading(false);
        return;
      }
      const found = adminList.find(a =>
        a.email.toLowerCase() === data.user.email.toLowerCase() && a.status === "active"
      );
      if (!found) {
        await supabase.auth.signOut();
        setPasswordError("This account is not authorized as an admin.");
        setLoading(false);
        return;
      }
      // Sign out of Supabase session immediately — admin state is managed
      // by App.jsx activeUser, not a persistent Supabase session. Without
      // this, App's authOnChange listener picks up the SIGNED_IN event and
      // re-routes the user to the customer portal if they're also a client.
      await supabase.auth.signOut();
      try { localStorage.setItem(STORAGE_KEY, found.email); } catch {}
      onLogin({ id: found.id, name: found.name, role: "admin", email: found.email });
    } catch (e) {
      setPasswordError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const e = (savedEmail || email).trim().toLowerCase();
    if (!e) { setPasswordError("Enter your email first."); return; }
    setLoading(true);
    await supabase.auth.resetPasswordForEmail(e, {
      // ?admin_reset=1 is preserved by Supabase when it appends the token hash,
      // so App.jsx can detect this is an admin reset vs a client reset.
      redirectTo: `${window.location.origin}/?admin_reset=1`,
    });
    setLoading(false);
    setStage("forgot-sent");
  };

  const handleForgetMe = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setSavedEmail(null); setEmail(""); setPassword(""); setStage("entry");
  };

  return (
    <div style={{
      minHeight: "100svh",
      background: "linear-gradient(135deg,#4D2E10 0%,#5C3818 50%,#4D2E10 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "clamp(20px,5vw,48px) 16px",
    }}>
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

      <div className="auth-card" style={{
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "24px", padding: "36px 32px",
      }}>

        {/* ── Email entry ── */}
        {stage === "entry" && (
          <div className="fade-up">
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
              fontSize: "15px", textAlign: "center", marginBottom: "24px" }}>
              Enter your admin email to continue.
            </div>
            <input
              type="email" placeholder="you@example.com" value={email}
              onChange={e => { setEmail(e.target.value); setEmailError(""); }}
              onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
              style={{
                width: "100%", padding: "14px 16px", borderRadius: "12px",
                border: emailError ? "1.5px solid #ef4444" : "1.5px solid #8B5220",
                background: "#5C3818", color: "#fff", fontSize: "15px",
                fontFamily: "'DM Sans', sans-serif", marginBottom: "12px", boxSizing: "border-box",
              }}
            />
            {emailError && (
              <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
                fontSize: "14px", marginBottom: "10px" }}>{emailError}</div>
            )}
            <button onClick={handleEmailSubmit} style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 500, cursor: "pointer",
            }}>
              Continue →
            </button>
          </div>
        )}

        {/* ── Password entry ── */}
        {stage === "password" && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb",
                fontSize: "15px", marginBottom: "6px" }}>Admin access</div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: "8px",
                background: "rgba(180,83,9,0.25)", borderRadius: "20px",
                padding: "5px 12px 5px 10px", marginBottom: "4px",
              }}>
                <span style={{ fontSize: "16px" }}>🛡️</span>
                <span style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                  fontSize: "15px", fontWeight: 500 }}>{savedEmail || email}</span>
              </div>
            </div>

            <input
              type="password" placeholder="Password" value={password}
              onChange={e => { setPassword(e.target.value); setPasswordError(""); }}
              onKeyDown={e => e.key === "Enter" && handlePasswordSubmit()}
              autoFocus
              style={{
                width: "100%", padding: "14px 16px", borderRadius: "12px",
                border: passwordError ? "1.5px solid #ef4444" : "1.5px solid #8B5220",
                background: "#5C3818", color: "#fff", fontSize: "16px",
                fontFamily: "'DM Sans', sans-serif", marginBottom: "12px",
                boxSizing: "border-box", outline: "none",
              }}
            />
            {passwordError && (
              <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
                fontSize: "14px", marginBottom: "10px" }}>{passwordError}</div>
            )}

            <button onClick={handlePasswordSubmit} disabled={loading} style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 600, cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.75 : 1,
            }}>
              {loading ? "Signing in…" : "Sign In →"}
            </button>

            <button onClick={handleForgetMe} style={{
              marginTop: "14px", background: "none",
              border: "1px solid rgba(255,255,255,0.2)", borderRadius: "8px",
              padding: "9px 16px", color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "14px", cursor: "pointer", width: "100%", opacity: 0.75,
            }}>
              {savedEmail ? "← Not you? Switch account" : "← Use a different email"}
            </button>

            <button onClick={handleForgotPassword} disabled={loading} style={{
              marginTop: "10px", background: "none", border: "none", color: amber,
              fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
              cursor: "pointer", width: "100%", textDecoration: "underline",
            }}>
              Forgot password?
            </button>
          </div>
        )}

        {/* ── Forgot password — email sent ── */}
        {stage === "forgot-sent" && (
          <div className="fade-up" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "14px" }}>📬</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "20px", fontWeight: 700, marginBottom: "10px" }}>Check your email</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "15px", lineHeight: "1.7", marginBottom: "24px" }}>
              We sent a password reset link to{" "}
              <strong style={{ color: "#fff" }}>{savedEmail || email}</strong>.<br />
              Click the link in that email to set a new password.
            </div>
            <button onClick={() => { setStage("password"); setPassword(""); }}
              style={{ background: "none", border: "none", color: amber,
                fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                cursor: "pointer", textDecoration: "underline" }}>
              Back to sign in
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
