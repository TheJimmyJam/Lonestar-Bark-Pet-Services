import { useState, useEffect, useRef } from "react";
import { sbFetch } from "../../supabase.js";
import { formatPhone, emptyAddr, addrToString, addrFromString } from "../../helpers.js";
import AddressFields from "../shared/AddressFields.jsx";

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
  const me = adminList.find(a => a.id === admin.id) || { name: admin.name, email: admin.email, pin: "" };
  const [editing, setEditing]     = useState(false);
  const [draftName, setDraftName] = useState(me.name);
  const [draftPin, setDraftPin]   = useState("");
  const [draftPin2, setDraftPin2] = useState("");
  const [infoErrors, setInfoErrors] = useState({});
  const [infoSaved, setInfoSaved]   = useState(false);

  const handleSaveInfo = () => {
    const errs = {};
    if (!draftName.trim()) errs.name = "Name is required.";
    if (draftPin) {
      if (!/^\d{6}$/.test(draftPin)) errs.pin = "PIN must be exactly 6 digits.";
      else if (draftPin !== draftPin2) errs.pin2 = "PINs don't match.";
      else {
        const dup = adminList.find(a => a.id !== admin.id && a.pin === draftPin && a.status === "active");
        if (dup) errs.pin = "That PIN is already used by another admin.";
      }
    }
    if (Object.keys(errs).length) { setInfoErrors(errs); return; }

    const updated = adminList.map(a =>
      a.id === admin.id
        ? { ...a, name: draftName.trim(), ...(draftPin ? { pin: draftPin } : {}) }
        : a
    );
    setAdminList(updated);
    setAdmin({ ...admin, name: draftName.trim() });
    setEditing(false);
    setDraftPin(""); setDraftPin2(""); setInfoErrors({});
    setInfoSaved(true); setTimeout(() => setInfoSaved(false), 2500);
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
            <button onClick={() => { setEditing(true); setDraftName(me.name); setDraftPin(""); setDraftPin2(""); setInfoErrors({}); }}
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
            <div>
              <div style={labelStyle}>PIN</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#111827", letterSpacing: "6px" }}>
                ••••
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
            <div>
              <label style={labelStyle}>New PIN (leave blank to keep current)</label>
              <input type="password" inputMode="numeric" maxLength={6} placeholder="••••••" value={draftPin}
                onChange={e => { setDraftPin(e.target.value.replace(/\D/g,"")); setInfoErrors(p => ({ ...p, pin: "" })); }}
                style={{ ...iStyle(infoErrors.pin), letterSpacing: "8px", fontSize: "20px" }} />
              {infoErrors.pin && <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
                fontSize: "14px", marginTop: "4px" }}>{infoErrors.pin}</div>}
            </div>
            {draftPin && (
              <div>
                <label style={labelStyle}>Confirm New PIN</label>
                <input type="password" inputMode="numeric" maxLength={6} placeholder="••••••" value={draftPin2}
                  onChange={e => { setDraftPin2(e.target.value.replace(/\D/g,"")); setInfoErrors(p => ({ ...p, pin2: "" })); }}
                  style={{ ...iStyle(infoErrors.pin2), letterSpacing: "8px", fontSize: "20px" }} />
                {infoErrors.pin2 && <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "14px", marginTop: "4px" }}>{infoErrors.pin2}</div>}
              </div>
            )}
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

    </div>
  );
}


export default AdminMyInfo;
