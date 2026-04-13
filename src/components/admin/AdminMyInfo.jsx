import { useState } from "react";
import { sbFetch } from "../../supabase.js";
import { supabase } from "../../supabase.js";

// ─── Admin My Info Tab ────────────────────────────────────────────────────────
function AdminMyInfo({ admin, setAdmin, adminList, setAdminList, onLogout }) {
  const amber = "#b45309";
  const iStyle = (err) => ({
    width: "100%", padding: "11px 14px", borderRadius: "10px", boxSizing: "border-box",
    border: `1.5px solid ${err ? "#ef4444" : "#e4e7ec"}`,
    background: "#fff", fontFamily: "'DM Sans', sans-serif",
    fontSize: "15px", color: "#111827", outline: "none",
  });
  const labelStyle = {
    display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
    fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
    color: "#9ca3af", marginBottom: "6px",
  };

  // ── Edit My Info ──
  const me = adminList.find(a => a.id === admin.id) || { name: admin.name, email: admin.email };
  const [editing, setEditing]     = useState(false);
  const [draftName, setDraftName] = useState(me.name);
  const [infoErrors, setInfoErrors] = useState({});
  const [infoSaved, setInfoSaved]   = useState(false);

  const handleSaveInfo = () => {
    const errs = {};
    if (!draftName.trim()) errs.name = "Name is required.";
    if (Object.keys(errs).length) { setInfoErrors(errs); return; }

    const updated = adminList.map(a =>
      a.id === admin.id ? { ...a, name: draftName.trim() } : a
    );
    setAdminList(updated);
    setAdmin({ ...admin, name: draftName.trim() });
    setEditing(false);
    setInfoErrors({});
    setInfoSaved(true); setTimeout(() => setInfoSaved(false), 2500);
  };

  // ── Change Password ──
  const [newPw, setNewPw]       = useState("");
  const [newPw2, setNewPw2]     = useState("");
  const [pwError, setPwError]   = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwSaved, setPwSaved]   = useState(false);

  const handleChangePassword = async () => {
    setPwError("");
    if (!newPw) { setPwError("Enter a new password."); return; }
    if (newPw.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    if (newPw !== newPw2) { setPwError("Passwords don't match."); return; }
    setPwLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) { setPwError(error.message); return; }
      setNewPw(""); setNewPw2("");
      setPwSaved(true); setTimeout(() => setPwSaved(false), 3000);
    } catch {
      setPwError("Something went wrong. Please try again.");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="fade-up" style={{ maxWidth: "520px" }}>
      {/* ── My Info card ── */}
      <div style={{ background: "#fff", borderRadius: "16px", border: "1.5px solid #e4e7ec",
        padding: "24px", marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color: "#111827" }}>
              My Info
            </div>
            {me?.isMaster && (
              <span style={{ background: "#fffbeb", border: "1.5px solid #fde68a",
                borderRadius: "20px", padding: "2px 10px",
                fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                fontWeight: 700, color: "#b45309", letterSpacing: "0.5px" }}>
                ⭐ Master Admin
              </span>
            )}
          </div>
          {!editing && (
            <button onClick={() => { setEditing(true); setDraftName(me.name); setInfoErrors({}); }}
              style={{ padding: "7px 14px", borderRadius: "8px", border: "1.5px solid #e4e7ec",
                background: "#f9fafb", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#374151", cursor: "pointer", fontWeight: 500 }}>
              Edit
            </button>
          )}
        </div>

        {!editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <div style={labelStyle}>Name</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#111827", fontWeight: 500 }}>
                {me.name || <span style={{ color: "#9ca3af" }}>Not set</span>}
              </div>
            </div>
            <div>
              <div style={labelStyle}>Email</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#111827" }}>
                {me.email}
              </div>
            </div>
            {infoSaved && (
              <div style={{ color: "#16a34a", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 500 }}>✓ Changes saved</div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input value={draftName} onChange={e => { setDraftName(e.target.value); setInfoErrors(p => ({ ...p, name: "" })); }}
                placeholder="Your name" style={iStyle(infoErrors.name)} />
              {infoErrors.name && <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
                fontSize: "14px", marginTop: "4px" }}>{infoErrors.name}</div>}
            </div>
            <div>
              <label style={labelStyle}>Email (read-only)</label>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#6b7280", padding: "11px 0" }}>{me.email}</div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button onClick={handleSaveInfo} style={{ flex: 1, padding: "12px", borderRadius: "10px",
                border: "none", background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>Save Changes</button>
              <button onClick={() => { setEditing(false); setInfoErrors({}); }} style={{ padding: "12px 18px",
                borderRadius: "10px", border: "1.5px solid #e4e7ec", background: "#f9fafb",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#374151", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Change Password card ── */}
      <div style={{ background: "#fff", borderRadius: "16px", border: "1.5px solid #e4e7ec",
        padding: "24px", marginBottom: "24px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
          textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
          color: "#111827", marginBottom: "16px" }}>Change Password</div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={labelStyle}>New Password</label>
            <input
              type="password"
              placeholder="At least 8 characters"
              value={newPw}
              onChange={e => { setNewPw(e.target.value); setPwError(""); }}
              style={iStyle(!!pwError)}
            />
          </div>
          <div>
            <label style={labelStyle}>Confirm New Password</label>
            <input
              type="password"
              placeholder="Repeat password"
              value={newPw2}
              onChange={e => { setNewPw2(e.target.value); setPwError(""); }}
              onKeyDown={e => e.key === "Enter" && handleChangePassword()}
              style={iStyle(!!pwError)}
            />
          </div>

          {pwError && (
            <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>
              {pwError}
            </div>
          )}
          {pwSaved && (
            <div style={{ color: "#16a34a", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", fontWeight: 500 }}>✓ Password updated</div>
          )}

          <button onClick={handleChangePassword} disabled={pwLoading} style={{
            padding: "12px", borderRadius: "10px", border: "none",
            background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", fontWeight: 600, cursor: pwLoading ? "wait" : "pointer",
            opacity: pwLoading ? 0.75 : 1,
          }}>
            {pwLoading ? "Saving…" : "Update Password"}
          </button>
        </div>
      </div>

    </div>
  );
}


export default AdminMyInfo;
