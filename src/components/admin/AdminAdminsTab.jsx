import { useState, useEffect } from "react";
import { sbFetch, saveClients, saveWalkerProfiles, saveAdminList, removeAdminFromDB } from "../../supabase.js";
import { generateCode, formatPhone } from "../../helpers.js";
import AdminDangerZone from "./AdminDangerZone.jsx";
import AdminDemoDataSection from "./AdminDemoDataSection.jsx";

// ─── Admin Admins Tab ─────────────────────────────────────────────────────────
function AdminAdminsTab({ admin, adminList, setAdminList, clients, setClients, walkerProfiles, setWalkerProfiles, onLogout }) {
  const amber = "#b45309";
  const iStyle = (err) => ({
    width: "100%", padding: "11px 14px", borderRadius: "10px", boxSizing: "border-box",
    border: `1.5px solid ${err ? "#ef4444" : "#e4e7ec"}`,
    background: "#fff", fontFamily: "'DM Sans', sans-serif",
    fontSize: "15px", color: "#111827", outline: "none",
  });

  const me = adminList.find(a => a.id === admin.id) || admin;

  // ── Invite ──
  const [inviteEmail, setInviteEmail]   = useState("");
  const [inviteError, setInviteError]   = useState("");
  const [inviteSent, setInviteSent]     = useState(false);
  const [invitedEmail, setInvitedEmail] = useState("");

  const handleInvite = async () => {
    const e = inviteEmail.trim().toLowerCase();
    if (!e || !e.includes("@")) { setInviteError("Enter a valid email address."); return; }
    const exists = adminList.find(a => a.email.toLowerCase() === e);
    if (exists) {
      setInviteError(exists.status === "invited"
        ? "An invite is already pending for this email."
        : "This email already has an admin account.");
      return;
    }
    const newAdmin = {
      id: `admin-${Date.now()}`,
      name: "",
      email: e,
      status: "invited",
      invitedBy: admin.email,
      createdAt: new Date().toISOString(),
    };
    const updated = [...adminList, newAdmin];
    try {
      await saveAdminList(updated);
      setAdminList(updated);
      // Send Supabase invite email so they can set their password
      try {
        await fetch(`https://mvkmxmhsudqwxrsiifms.supabase.co/functions/v1/admin-invite`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a214bWhzdWRxd3hyc2lpZm1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NTEyMDIsImV4cCI6MjA5MTAyNzIwMn0.dP6PunUbTuuNs3K4CFBVmP8hmV29MBFActwemoDysxk`,
          },
          body: JSON.stringify({ email: e }),
        });
      } catch {
        // Non-fatal — admin is saved, email delivery may still work
      }
      setInvitedEmail(e);
      setInviteEmail("");
      setInviteError("");
      setInviteSent(true);
      setTimeout(() => setInviteSent(false), 8000);
    } catch (err) {
      setInviteError("Failed to save invite. Check your connection and try again.");
    }
  };

  const handleRemove = (targetId) => {
    if (targetId === admin.id) return;
    setAdminList(adminList.filter(a => a.id !== targetId));
    removeAdminFromDB(targetId);
  };

  const activeAdmins  = adminList.filter(a => a.status === "active");
  const pendingAdmins = adminList.filter(a => a.status === "invited");

  // ── Transfer master ──
  const [transferTarget, setTransferTarget] = useState(null);
  const handleTransferMaster = () => {
    if (!transferTarget) return;
    setAdminList(adminList.map(a => ({ ...a, isMaster: a.id === transferTarget.id })));
    setTransferTarget(null);
  };

  return (
    <div className="fade-up" style={{ maxWidth: "560px" }}>

      {/* ── Admin Team ── */}
      <div style={{ background: "#fff", borderRadius: "16px", border: "1.5px solid #e4e7ec",
        padding: "24px", marginBottom: "24px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
          textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
          color: "#111827", marginBottom: "16px" }}>Admin Team</div>

        {activeAdmins.map(a => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 0", borderBottom: "1px solid #f3f4f6", gap: "12px" }}>
            <div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "#111827" }}>
                🛡️ {a.name || "(No name)"}
                {a.id === admin.id && (
                  <span style={{ marginLeft: "8px", fontSize: "13px", color: amber, fontWeight: 400 }}>You</span>
                )}
                {a.isMaster && (
                  <span style={{ marginLeft: "6px", fontSize: "12px", color: "#b45309",
                    background: "#fffbeb", border: "1px solid #fde68a",
                    borderRadius: "10px", padding: "1px 7px", fontWeight: 700 }}>⭐ Master</span>
                )}
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#6b7280" }}>{a.email}</div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              {me?.isMaster && a.id !== admin.id && !a.isMaster && (
                <button onClick={() => setTransferTarget(a)}
                  style={{ padding: "5px 12px", borderRadius: "7px",
                    border: "1px solid #fde68a", background: "#fffbeb",
                    color: "#b45309", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                  ⭐ Make Master
                </button>
              )}
              {a.id !== admin.id && !a.isMaster && activeAdmins.length > 1 && (
                <button onClick={() => handleRemove(a.id)}
                  style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #fca5a5",
                    background: "#fff5f5", color: "#dc2626", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "13px", cursor: "pointer" }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}

        {pendingAdmins.length > 0 && (
          <>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
              textTransform: "uppercase", letterSpacing: "1px", color: "#9ca3af",
              fontWeight: 600, marginTop: "16px", marginBottom: "8px" }}>Pending Invites</div>
            {pendingAdmins.map(a => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#374151" }}>{a.email}</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af" }}>
                    Invited by {a.invitedBy} · Awaiting setup
                  </div>
                </div>
                <button onClick={() => handleRemove(a.id)}
                  style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #e4e7ec",
                    background: "#f9fafb", color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "13px", cursor: "pointer" }}>
                  Revoke
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Invite New Admin ── */}
      <div style={{ background: "#fff", borderRadius: "16px", border: "1.5px solid #e4e7ec",
        padding: "24px", marginBottom: "24px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
          textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
          color: "#111827", marginBottom: "6px" }}>Invite a New Admin</div>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
          marginBottom: "16px", lineHeight: "1.6" }}>
          Enter their email address. They'll receive an invite email with a link to set their password.
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          <input type="email" placeholder="newadmin@example.com" value={inviteEmail}
            onChange={e => { setInviteEmail(e.target.value); setInviteError(""); }}
            onKeyDown={e => e.key === "Enter" && handleInvite()}
            style={{ ...iStyle(!!inviteError), flex: 1 }} />
          <button onClick={handleInvite} style={{ padding: "11px 18px", borderRadius: "10px",
            border: "none", background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            Send Invite
          </button>
        </div>
        {inviteError && (
          <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
            fontSize: "14px", marginTop: "8px" }}>{inviteError}</div>
        )}
        {inviteSent && (
          <div style={{ marginTop: "14px", background: "#f0fdf4", border: "1.5px solid #86efac",
            borderRadius: "10px", padding: "14px 16px" }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              fontWeight: 600, color: "#16a34a", marginBottom: "4px" }}>✓ Invite created!</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#15803d" }}>
              An invite email has been sent to <strong>{invitedEmail}</strong>. They'll click the link
              to set their password, then log in at the admin portal.
            </div>
          </div>
        )}
      </div>

      {/* ── Demo Data ── */}
      <AdminDemoDataSection
        clients={clients}
        setClients={setClients}
        walkerProfiles={walkerProfiles}
        setWalkerProfiles={setWalkerProfiles}
      />

      {/* ── Danger Zone (master admin only) ── */}
      {me?.isMaster && (
        <AdminDangerZone
          admin={admin}
          adminList={adminList}
          setAdminList={setAdminList}
          setClients={setClients}
          setWalkerProfiles={setWalkerProfiles}
          onLogout={onLogout}
        />
      )}

      {/* ── Transfer Master Modal ── */}
      {transferTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500,
          display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div onClick={() => setTransferTarget(null)}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
          <div className="fade-up" style={{ position: "relative", background: "#fff",
            borderRadius: "20px", padding: "32px 28px", maxWidth: "420px", width: "100%",
            boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: "36px", textAlign: "center", marginBottom: "14px" }}>⭐</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px",
              fontWeight: 700, color: "#111827", textAlign: "center", marginBottom: "10px" }}>
              Transfer Master Admin?
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              color: "#6b7280", textAlign: "center", lineHeight: "1.6", marginBottom: "24px" }}>
              You are about to make{" "}
              <strong style={{ color: "#111827" }}>{transferTarget.name || transferTarget.email}</strong>{" "}
              the Master Admin. You will immediately lose your Master Admin privileges,
              including access to the Danger Zone.{" "}
              <strong style={{ color: "#dc2626" }}>This cannot be undone by you.</strong>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button onClick={handleTransferMaster}
                style={{ width: "100%", padding: "13px", borderRadius: "11px",
                  border: "none", background: amber, color: "#fff",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 700, cursor: "pointer" }}>
                Yes, transfer to {transferTarget.name || transferTarget.email}
              </button>
              <button onClick={() => setTransferTarget(null)}
                style={{ width: "100%", padding: "13px", borderRadius: "11px",
                  border: "1.5px solid #e4e7ec", background: "#f9fafb",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#374151", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default AdminAdminsTab;
