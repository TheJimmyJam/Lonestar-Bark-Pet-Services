import { useState, useEffect } from "react";

// Shows a sticky banner when the browser loses network connectivity.
// Automatically hides when the connection is restored.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [justRestored, setJustRestored] = useState(false);

  useEffect(() => {
    const goOffline = () => { setOffline(true); setJustRestored(false); };
    const goOnline  = () => { setOffline(false); setJustRestored(true); setTimeout(() => setJustRestored(false), 3000); };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online",  goOnline);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, []);

  if (!offline && !justRestored) return null;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: offline ? "#1f2937" : "#14532d",
      color: "#fff", fontFamily: "'DM Sans', sans-serif",
      fontSize: "14px", fontWeight: 500,
      padding: "10px 20px", textAlign: "center",
      display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      transition: "background 0.3s ease",
    }}>
      {offline ? (
        <>
          <span>📡</span>
          <span>You're offline — changes won't save until your connection is restored.</span>
        </>
      ) : (
        <>
          <span>✅</span>
          <span>Back online — you're good to go.</span>
        </>
      )}
    </div>
  );
}
