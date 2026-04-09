import LogoBadge from "./LogoBadge.jsx";

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ client, onLogout }) {
  return (
    <header style={{ background: "#0B1423", padding: "16px 24px 14px", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", marginBottom: "4px" }}>
        <LogoBadge size={48} />
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
          fontSize: "clamp(22px,5vw,34px)", fontWeight: 600, letterSpacing: "2px" }}>
          Lonestar Bark Co.
        </div>
      </div>
      <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffff99",
        fontSize: "16px", letterSpacing: "3px", textTransform: "uppercase", fontWeight: 300 }}>
        Professional Pet Care
      </div>
      {client && (
        <div style={{ marginTop: "12px", display: "flex", alignItems: "center",
          justifyContent: "center", gap: "10px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffbb", fontSize: "15px" }}>
            Welcome back, <strong style={{ color: "#fff" }}>{client.name || client.email}</strong>
          </div>
          <button onClick={onLogout} style={{ background: "transparent", border: "1px solid #ffffff44",
            color: "#ffffffbb", padding: "3px 10px", borderRadius: "6px", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontSize: "15px" }}>
            Log out
          </button>
        </div>
      )}
    </header>
  );
}


export default Header;
