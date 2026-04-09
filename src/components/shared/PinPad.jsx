import { useState, useEffect, useRef } from "react";

// ─── PIN Pad ──────────────────────────────────────────────────────────────────
function PinPad({ length = 4, onComplete, label, color = "#C4541A", error }) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (error) { setShake(true); setPin(""); setTimeout(() => setShake(false), 600); }
  }, [error]);

  const press = (val) => {
    if (pin.length >= length) return;
    const next = pin + val;
    setPin(next);
    if (next.length === length) setTimeout(() => { onComplete(next); setPin(""); }, 140);
  };
  const del = () => setPin(p => p.slice(0, -1));

  // Keyboard support
  useEffect(() => {
    const handler = (e) => {
      if (e.key >= "0" && e.key <= "9") { press(e.key); }
      else if (e.key === "Backspace")    { del(); }
      else if (e.key === "Enter")        { if (pin.length === length) { onComplete(pin); setPin(""); } }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pin]);

  const KEYS = [["1","2","3"],["4","5","6"],["7","8","9"],["←","0","✓"]];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#9ca3af", fontSize: "16px",
        letterSpacing: "1px", textTransform: "uppercase", marginBottom: "20px" }}>{label}</div>
      <div className={shake ? "shake" : ""} style={{ display: "flex", gap: "14px", marginBottom: "28px" }}>
        {Array.from({ length }).map((_, i) => (
          <div key={i} style={{
            width: "14px", height: "14px", borderRadius: "50%",
            background: error ? "#ef4444" : pin.length > i ? color : "transparent",
            border: `2px solid ${error ? "#ef4444" : pin.length > i ? color : "#1a2d45"}`,
            transition: "all 0.15s",
            boxShadow: pin.length > i && !error ? `0 0 8px ${color}66` : "none",
          }} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {KEYS.map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: "10px" }}>
            {row.map(k => (
              <button key={k} className="key-btn"
                onClick={() => k === "←" ? del() : k === "✓" ? (pin.length === length && onComplete(pin)) : press(k)}
                style={{
                  width: "68px", height: "68px", borderRadius: "14px",
                  border: "1.5px solid #4A2E18",
                  background: k === "✓" ? color : k === "←" ? "#1e3550" : "#0B1423",
                  color: "#fff", fontSize: k === "←" || k === "✓" ? "18px" : "20px",
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 500, cursor: "pointer",
                }}>{k}</button>
            ))}
          </div>
        ))}
      </div>
      {error && (
        <div style={{ marginTop: "16px", fontFamily: "'DM Sans', sans-serif",
          color: "#ef4444", fontSize: "15px" }}>{error}</div>
      )}
    </div>
  );
}


export default PinPad;
