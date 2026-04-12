import { useState, useEffect, useRef } from "react";
import LogoBadge from "./LogoBadge.jsx";

// ─── Client Nav ───────────────────────────────────────────────────────────────
function ClientNav({ client, onLogout, page, setPage, notifCounts = {}, onRefresh, refreshing = false, sticky = false }) {
  if (!client) return null;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const scrollTop = () => document.querySelector('[data-scroll-pane]')?.scrollTo({ top: 0, behavior: 'instant' });
  const clientTabs = [
    { id: "overview", label: "Dashboard",   icon: "🏠" },
    { id: "book",     label: "Book a Walk", icon: "🐾" },
    { id: "mywalks",  label: "My Walks",    icon: "📅" },
    { id: "invoices", label: "Invoices",    icon: "🧾" },
    { id: "pricing",  label: "Pricing",     icon: "💰" },
    ...(client.keyholder ? [{ id: "messages", label: "Messages", icon: "💬" }] : []),
    { id: "myinfo",   label: "My Info",     icon: "👤" },
    { id: "contact",  label: "Contact Us",  icon: "✉️" },
  ];
  const totalBadges = Object.values(notifCounts).reduce((s, n) => s + n, 0);

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <nav style={{ background: "#0B1423", borderBottom: "1px solid #8A7545",
      display: "flex", flexDirection: "column",
      ...(sticky ? { position: "sticky", top: 0, zIndex: 50 } : { flexShrink: 0 }) }}
      className={`nav-tabs${sticky ? " sticky-nav" : ""}`}>

      {/* ── Row 1: refresh + hamburger on the right ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end",
        borderBottom: "1px solid #8A754566" }}>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh data"
            style={{
              padding: "8px 14px", border: "none", background: "transparent",
              color: refreshing ? "#ffffff33" : "#ffffff66",
              fontSize: "18px", lineHeight: 1, cursor: refreshing ? "default" : "pointer",
              display: "flex", alignItems: "center",
              animation: refreshing ? "spin 0.8s linear infinite" : "none",
              transition: "color 0.15s",
            }}>↻</button>
        )}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen(o => !o)} style={{
            padding: "8px 18px", border: "none", background: "transparent",
            cursor: "pointer", display: "flex", alignItems: "center",
            color: menuOpen ? "#fff" : "#ffffff99", transition: "color 0.15s",
          }}>
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ display: "block", width: "18px", height: "2px", background: "currentColor", borderRadius: "2px" }} />
                <span style={{ display: "block", width: "18px", height: "2px", background: "currentColor", borderRadius: "2px" }} />
                <span style={{ display: "block", width: "18px", height: "2px", background: "currentColor", borderRadius: "2px" }} />
              </div>
              {totalBadges > 0 && !menuOpen && (
                <span style={{ position: "absolute", top: "-5px", right: "-5px",
                  background: "#ef4444", color: "#fff", borderRadius: "50%",
                  width: "14px", height: "14px", fontSize: "9px", fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'DM Sans', sans-serif" }}>{totalBadges}</span>
              )}
            </div>
          </button>

          {/* Fixed drawer — full left-side slide-in with backdrop */}
          {menuOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
              {/* Backdrop */}
              <div onClick={() => setMenuOpen(false)}
                style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
              {/* Drawer */}
              <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "280px",
                background: "#0B1423", display: "flex", flexDirection: "column",
                boxShadow: "4px 0 28px rgba(0,0,0,0.4)", overflowY: "auto" }}>
                {/* Drawer header */}
                <div style={{ padding: "24px 20px 16px", borderBottom: "1px solid #1E4A32",
                  display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <LogoBadge size={28} />
                    <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                      fontSize: "15px", textTransform: "uppercase", fontWeight: 600, letterSpacing: "1px" }}>
                      Lonestar Bark Co.
                    </div>
                  </div>
                  <button onClick={() => setMenuOpen(false)} style={{ background: "none",
                    border: "none", color: "#9B7444", fontSize: "22px", cursor: "pointer", lineHeight: 1 }}>✕</button>
                </div>
                {/* Tab list */}
                <div style={{ flex: 1, padding: "12px 0" }}>
                  {clientTabs.map(t => {
                    const badge = notifCounts[t.id] || 0;
                    const isActive = page === t.id;
                    return (
                      <button key={t.id} onClick={() => { setPage(t.id); scrollTop(); setMenuOpen(false); }} style={{
                        width: "100%", padding: "13px 20px", border: "none",
                        background: isActive ? "rgba(139,94,60,0.18)" : "transparent",
                        borderLeft: isActive ? "3px solid #8B5E3C" : "3px solid transparent",
                        display: "flex", alignItems: "center", gap: "14px", cursor: "pointer",
                      }}>
                        <span style={{ fontSize: "18px", width: "24px", textAlign: "center" }}>{t.icon}</span>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? "#fff" : "rgba(255,255,255,0.75)", flex: 1 }}>{t.label}</span>
                        {badge > 0 && (
                          <span style={{ background: "#ef4444", color: "#fff", borderRadius: "10px",
                            fontSize: "11px", fontWeight: 700, padding: "1px 6px",
                            minWidth: "16px", textAlign: "center" }}>{badge}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* Contact Us + Logout */}
                <div style={{ padding: "16px 20px", borderTop: "1px solid #1E4A32", display: "flex", gap: "10px" }}>
                  <button onClick={() => { setPage("contact"); scrollTop(); setMenuOpen(false); }} style={{
                    flex: 1, padding: "11px", borderRadius: "10px",
                    border: "1px solid #8A7545", background: "transparent",
                    color: "#9B7444", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", cursor: "pointer",
                  }}>✉️ Contact Us</button>
                  <button onClick={() => { setMenuOpen(false); onLogout(); }} style={{
                    flex: 1, padding: "11px", borderRadius: "10px",
                    border: "1px solid #8A7545", background: "transparent",
                    color: "#9B7444", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", cursor: "pointer",
                  }}>↩ Log out</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: pinned Dashboard + scrolling rest ── */}
      <div style={{ display: "flex", alignItems: "stretch" }}>
        {/* Pinned Dashboard tab */}
        {(() => {
          const t = clientTabs[0];
          return (
            <button onClick={() => { setPage(t.id); scrollTop(); }} style={{
              padding: "10px 16px", border: "none", whiteSpace: "nowrap", background: "transparent",
              borderBottom: page === t.id ? "3px solid #8B5E3C" : "3px solid transparent",
              borderRight: "1px solid #8A754566",
              color: page === t.id ? "#fff" : "#ffffff88",
              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              fontWeight: page === t.id ? 600 : 400,
              cursor: "pointer", transition: "color 0.15s, border-color 0.15s",
              display: "flex", alignItems: "center", gap: "5px", flexShrink: 0,
            }}>
              <span style={{ fontSize: "14px" }}>{t.icon}</span> {t.label}
            </button>
          );
        })()}
        {/* Scrollable remaining tabs + logout free-flowing at end */}
        <div style={{ flex: 1, overflowX: "auto", display: "flex",
          scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {clientTabs.slice(1).map(t => {
            const badge = notifCounts[t.id] || 0;
            return (
              <button key={t.id} onClick={() => { setPage(t.id); scrollTop(); }} style={{
                padding: "10px 16px", border: "none", whiteSpace: "nowrap", background: "transparent",
                borderBottom: page === t.id ? "3px solid #8B5E3C" : "3px solid transparent",
                color: page === t.id ? "#fff" : "#ffffff88",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                fontWeight: page === t.id ? 600 : 400,
                cursor: "pointer", transition: "color 0.15s, border-color 0.15s",
                display: "flex", alignItems: "center", gap: "5px", flexShrink: 0,
              }}>
                <span style={{ fontSize: "14px" }}>{t.icon}</span> {t.label}
                {badge > 0 && (
                  <span style={{ background: "#ef4444", color: "#fff", borderRadius: "10px",
                    fontSize: "11px", fontWeight: 700, padding: "1px 6px",
                    minWidth: "16px", textAlign: "center", display: "inline-block" }}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
          <button onClick={onLogout} style={{
            padding: "10px 14px", border: "none", background: "transparent",
            borderLeft: "1px solid #8A754566", borderBottom: "3px solid transparent",
            color: "#ffffff55", fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
            cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: "5px",
          }}>↩ Log out</button>
        </div>
      </div>
    </nav>
  );
}


export default ClientNav;
