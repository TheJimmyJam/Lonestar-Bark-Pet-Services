import { useState, useEffect } from "react";
import LogoBadge from "../shared/LogoBadge.jsx";

// ─── Role Selection Screen ────────────────────────────────────────────────────
function RoleSelectScreen({ onSelectRole, onBack }) {
  return (
    <div style={{
      minHeight: "100svh",
      background: "linear-gradient(160deg, #1E4A32 0%, #0B1423 60%, #112B20 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "clamp(24px,5vw,56px) 20px",
    }}>
      <style>{GLOBAL_STYLES}</style>

      {/* Header block */}
      <div style={{ textAlign: "center", marginBottom: "36px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
          fontSize: "clamp(28px,7vw,42px)", fontWeight: 700, letterSpacing: "2px", marginBottom: "8px" }}>
          Lonestar Bark Co.
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffff88",
          fontSize: "13px", letterSpacing: "3.5px", textTransform: "uppercase", marginBottom: "28px" }}>
          BORN HERE / WALK HERE / DALLAS, TX
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <LogoBadge size={120} />
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: "420px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb", fontSize: "15px",
          textAlign: "center", marginBottom: "20px", letterSpacing: "0.3px" }}>
          Who are you signing in as?
        </div>

        {[
          {
            role: "customer", label: "Client",
            sub: "Book walks & manage your pets",
            color: "#C4541A", bg: "#FDF5EC", accent: "#D4A843",
          },
          {
            role: "walker", label: "Walker",
            sub: "Claim walks, track pay & availability",
            color: "#1A3A42", bg: "#EBF4F6", accent: "#3D6B7A",
          },
          {
            role: "admin", label: "Admin",
            sub: "Manage all clients, walkers & bookings",
            color: "#7C3A00", bg: "#fffbeb", accent: "#b45309",
          },
        ].map(({ role, label, sub, color, bg, accent }) => (
          <button key={role} onClick={() => onSelectRole(role)}
            className="hover-card"
            style={{
              width: "100%", marginBottom: "12px",
              borderRadius: "16px", border: `2px solid ${accent}`,
              background: bg, cursor: "pointer",
              display: "flex", alignItems: "stretch", textAlign: "left",
              overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
            }}>
            {/* Colored left accent bar */}
            <div style={{ width: "6px", background: accent, flexShrink: 0 }} />
            {/* Text */}
            <div style={{ flex: 1, padding: "20px 18px",
              display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "17px",
                fontWeight: 700, color: color, marginBottom: "3px",
                textTransform: "uppercase", letterSpacing: "1px" }}>{label}</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                color: "#6b7280", lineHeight: "1.4" }}>{sub}</div>
            </div>
            {/* Arrow */}
            <div style={{ padding: "20px 18px", display: "flex",
              alignItems: "center", color: accent, fontSize: "20px",
              fontWeight: 700, flexShrink: 0 }}>›</div>
          </button>
        ))}

        <button onClick={onBack} style={{
          marginTop: "8px", width: "100%", padding: "13px", borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)",
          color: "#ffffffaa", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
          cursor: "pointer", letterSpacing: "0.3px",
        }}>← Back to homepage</button>
      </div>
    </div>
  );
}

// ─── Walker Auth Screen ───────────────────────────────────────────────────────
// Hard-coded walker credentials matching WALKERS array
// In production these would be in the DB; here PIN is walker.id * 1111
// This is a mutable object so custom walkers added by admin can be injected at runtime
let WALKER_CREDENTIALS = {};

// Registry of walkers added by admin at runtime (populated from walkerProfiles on load)
let CUSTOM_WALKERS = [];

// Returns the full merged walker list (built-in + custom), excluding deleted walkers

export default RoleSelectScreen;
