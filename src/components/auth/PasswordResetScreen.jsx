import { useState } from "react";
import LogoBadge from "../shared/LogoBadge.jsx";
import { GLOBAL_STYLES } from "../../styles.js";
import { authUpdatePassword, authSignOut } from "../../supabase.js";

// ─── Password Reset Screen ────────────────────────────────────────────────────
// Shown when App.jsx detects a PASSWORD_RECOVERY session (user arrived via
// the reset link in their email). Lets them set a new password, then signs
// them out so they log in fresh with the new credentials.
function PasswordResetScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (!password || password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    setSubmitting(true);
    const { error: err } = await authUpdatePassword(password);
    setSubmitting(false);
    if (err) { setError(err.message || "Couldn't update password."); return; }
    setSuccess(true);
    // Sign out so they log in fresh with the new password
    await authSignOut();
    setTimeout(() => { if (onDone) onDone(); }, 1800);
  };

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
          letterSpacing: "2px", marginTop: "10px",
        }}>
          Lonestar Bark Co.
        </div>
      </div>

      <div className="auth-card fade-up" style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "24px", padding: "28px",
        width: "100%", maxWidth: "420px",
      }}>
        {success ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>✅</div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "20px", fontWeight: 700, marginBottom: "8px",
            }}>
              Password updated
            </div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "14px", lineHeight: "1.6",
            }}>
              Redirecting you to log in with your new password…
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: "32px", marginBottom: "12px", textAlign: "center" }}>🔐</div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "20px", fontWeight: 700, marginBottom: "6px",
              textAlign: "center",
            }}>
              Set a new password
            </div>
            <div style={{
              fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
              fontSize: "14px", lineHeight: "1.6", marginBottom: "22px",
              textAlign: "center",
            }}>
              Choose something at least 8 characters long.
            </div>

            <label style={labelStyle}>New Password</label>
            <input
              type="password" placeholder="At least 8 characters" value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              style={{ ...inputStyle, marginBottom: "14px" }}
            />

            <label style={labelStyle}>Confirm Password</label>
            <input
              type="password" placeholder="Type it again" value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              style={{ ...inputStyle, marginBottom: "14px" }}
            />

            {error && (
              <div style={{
                color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px", marginBottom: "12px",
              }}>{error}</div>
            )}

            <button onClick={handleSubmit} disabled={submitting} style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: "#C4541A", color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}>
              {submitting ? "Updating…" : "Update password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default PasswordResetScreen;
