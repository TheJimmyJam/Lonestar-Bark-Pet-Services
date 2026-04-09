import { useState, useEffect, useRef, useMemo } from "react";
import { SERVICES } from "../../constants.js";
import { addrToString, firstName } from "../../helpers.js";
import { getAllWalkers } from "../auth/WalkerAuthScreen.jsx";
import Header from "../shared/Header.jsx";;

// ─── Admin Map View ───────────────────────────────────────────────────────────
function getTimeBand(isoOrDate) {
  const d = new Date(isoOrDate);
  const h = d.getHours() + d.getMinutes() / 60;
  return TIME_BANDS.find(b => h >= b.hours[0] && h < b.hours[1]) || TIME_BANDS[3];
}

function AdminMapView({ clients, walkerProfiles, geoCache, setGeoCache }) {
  const mapContainerRef = useRef(null);
  const leafletMapRef   = useRef(null);
  const geocodingRef    = useRef(false);

  const [leafletReady,  setLeafletReady]  = useState(!!window.L);
  const [geocoding,     setGeocoding]     = useState(false);
  const [geocodeDone,   setGeocodeDone]   = useState(false);
  const [progress,      setProgress]      = useState({ done: 0, total: 0 });
  const [selectedDate,  setSelectedDate]  = useState(() => new Date().toISOString().slice(0, 10));
  const [popupInfo,     setPopupInfo]     = useState(null);

  // Collect today's bookings
  const targetDate = new Date(selectedDate + "T00:00:00");
  const targetStr  = targetDate.toDateString();
  const dayBookings = [];
  Object.values(clients).forEach(c => {
    (c.bookings || []).forEach(b => {
      if (b.cancelled) return;
      const appt = new Date(b.scheduledDateTime || b.bookedAt);
      if (appt.toDateString() !== targetStr) return;
      dayBookings.push({
        ...b,
        clientId: c.id, clientName: c.name,
        clientAddress: c.address || addrToString(c.addrObj) || "",
      });
    });
  });
  dayBookings.sort((a, b) =>
    new Date(a.scheduledDateTime || a.bookedAt) - new Date(b.scheduledDateTime || b.bookedAt)
  );

  // All walkers with addresses
  const walkersWithAddr = getAllWalkers(walkerProfiles).map(w => ({
    w, prof: walkerProfiles[w.id] || {},
    addr: (walkerProfiles[w.id]?.address || addrToString(walkerProfiles[w.id]?.addrObj) || ""),
  })).filter(x => x.addr.trim());

  // Unique addresses to geocode
  const allAddresses = [...new Set([
    ...dayBookings.map(b => b.clientAddress).filter(Boolean),
    ...walkersWithAddr.map(x => x.addr),
  ])];

  // Stable key that changes whenever the set of addresses to geocode changes
  const addrKey = [...allAddresses].sort().join("|");

  // ── Load Leaflet ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => setLeafletReady(true);
    document.head.appendChild(script);
  }, []);

  // ── Geocode addresses ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || geocodingRef.current) return;
    const toFetch = allAddresses.filter(a => !(a in geoCache));
    if (toFetch.length === 0) { setGeocodeDone(true); return; }

    geocodingRef.current = true;
    setGeocoding(true);
    setGeocodeDone(false);
    setProgress({ done: 0, total: toFetch.length });

    let idx = 0;
    const next = () => {
      if (idx >= toFetch.length) {
        geocodingRef.current = false;
        setGeocoding(false);
        setGeocodeDone(true);
        return;
      }
      const addr = toFetch[idx++];
      fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr + ", Dallas, TX, USA")}&format=json&limit=1`,
        { headers: { "Accept-Language": "en" } }
      )
        .then(r => r.json())
        .then(data => {
          const hit = data[0];
          setGeoCache(prev => ({
            ...prev,
            [addr]: hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null,
          }));
        })
        .catch(() => setGeoCache(prev => ({ ...prev, [addr]: null })))
        .finally(() => {
          setProgress(p => ({ ...p, done: p.done + 1 }));
          setTimeout(next, 1150);
        });
    };
    next();
  }, [leafletReady, addrKey]); // re-runs when date changes OR new addresses appear

  // Reset geocoding state whenever the address set or date changes
  useEffect(() => {
    geocodingRef.current = false;
    setGeocodeDone(false);
  }, [addrKey]);

  // ── Build / refresh map ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current) return;
    const L = window.L;

    // Destroy old map
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
    }

    // Create map centered on Dallas
    const map = L.map(mapContainerRef.current, { zoomControl: true })
      .setView([32.7767, -96.7970], 11);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    leafletMapRef.current = map;

    // Helper: build colored circle div icon for booking pins
    const bookingIcon = (color, timeLabel) => L.divIcon({
      className: "",
      html: `<div style="width:36px;height:36px;border-radius:50%;background:${color};
        border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.28);
        display:flex;align-items:center;justify-content:center;
        font-family:sans-serif;font-size:9px;font-weight:700;color:#fff;
        line-height:1;text-align:center;padding:2px">${timeLabel}</div>`,
      iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
    });

    // Helper: rounded-square walker icon with initials
    const walkerIcon = (color, name) => {
      const initials = (name || "?").split(" ").map(p => p[0] || "").join("").slice(0, 2).toUpperCase();
      return L.divIcon({
        className: "",
        html: `<div style="width:40px;height:40px;border-radius:10px;background:${color};
          border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.35);
          display:flex;align-items:center;justify-content:center;
          font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;
          color:#fff;letter-spacing:0.5px">${initials}</div>`,
        iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22],
      });
    };

    const jitter = () => (Math.random() - 0.5) * 0.0025;
    const plotted = {};

    // Plot booking pins
    dayBookings.forEach(b => {
      const addr = b.clientAddress;
      if (!addr || !geoCache[addr]) return;
      const band = getTimeBand(b.scheduledDateTime || b.bookedAt);
      const coords = geoCache[addr];

      // Jitter overlapping addresses
      if (!plotted[addr]) plotted[addr] = 0;
      const offset = plotted[addr];
      plotted[addr]++;
      const lat = coords.lat + (offset ? jitter() : 0);
      const lng = coords.lng + (offset ? jitter() : 0);

      const apptTime = new Date(b.scheduledDateTime || b.bookedAt);
      const shortTime = apptTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        .replace(":00", "").replace(" AM", "a").replace(" PM", "p");

      L.marker([lat, lng], { icon: bookingIcon(band.color, shortTime) })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:'DM Sans',sans-serif;min-width:190px;padding:2px">
            <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:4px">
              ${b.form?.pet || "Pet"} · ${b.slot?.duration || ""}
            </div>
            <div style="font-size:12px;color:#6b7280;margin-bottom:3px">👤 ${b.clientName}</div>
            <div style="font-size:12px;margin-bottom:3px">
              🕐 ${b.slot?.time || shortTime}
              <span style="margin-left:6px;background:${band.color}20;color:${band.color};
                font-weight:600;border-radius:4px;padding:1px 6px;font-size:11px">${band.label}</span>
            </div>
            ${b.form?.walker ? `<div style="font-size:12px;color:#374151">🦺 ${b.form.walker}</div>` : ""}
            <div style="font-size:11px;color:#9ca3af;margin-top:5px;line-height:1.4">${addr}</div>
          </div>
        `);
    });

    // Plot walker home pins
    walkersWithAddr.forEach(({ w, prof, addr }) => {
      if (!geoCache[addr]) return;
      const { lat, lng } = geoCache[addr];
      L.marker([lat, lng], { icon: walkerIcon(w.color || "#C4541A", w.name || ""), zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:'DM Sans',sans-serif;min-width:170px;padding:2px">
            <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:3px">
              ${w.avatar} ${prof.preferredName || w.name}
            </div>
            <div style="font-size:12px;color:${w.color};margin-bottom:4px">${(w.role||"").replace(/ & /g, " / ")}</div>
            <div style="font-size:11px;color:#6b7280;line-height:1.4">🏠 ${addr}</div>
          </div>
        `);
    });

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [leafletReady, geoCache, selectedDate]);

  // Stats
  const plottedBookings = dayBookings.filter(b => b.clientAddress && geoCache[b.clientAddress]).length;
  const plottedWalkers  = walkersWithAddr.filter(x => geoCache[x.addr]).length;
  const missingAddrs    = dayBookings.filter(b => b.clientAddress && geoCache[b.clientAddress] === null).length;

  return (
    <div className="fade-up">

      {/* Header + date picker */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
            fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Walk Map</div>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
            {dayBookings.length} walk{dayBookings.length !== 1 ? "s" : ""} scheduled
            {geocoding
              ? ` · Geocoding ${progress.done}/${progress.total}…`
              : geocodeDone
                ? ` · ${plottedBookings} pinned${missingAddrs > 0 ? `, ${missingAddrs} address${missingAddrs !== 1 ? "es" : ""} not found` : ""}`
                : ""}
          </p>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "9px", border: "1.5px solid #e4e7ec",
            fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#111827",
            background: "#fff", cursor: "pointer", outline: "none" }}
        />
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
        {TIME_BANDS.map(b => (
          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: "6px",
            background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "8px",
            padding: "5px 10px" }}>
            <div style={{ width: "14px", height: "14px", borderRadius: "50%",
              background: b.color, flexShrink: 0 }} />
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              color: "#374151", fontWeight: 500 }}>{b.label} <span style={{ color: "#9ca3af" }}>{b.range}</span></span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: "6px",
          background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "8px",
          padding: "5px 10px" }}>
          <div style={{ width: "14px", height: "14px", borderRadius: "4px",
            background: "#C4541A", flexShrink: 0 }} />
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            color: "#374151", fontWeight: 500 }}>Walkers <span style={{ color: "#9ca3af" }}>home</span></span>
        </div>
      </div>

      {/* Geocoding progress bar */}
      {geocoding && (
        <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "10px",
          padding: "12px 16px", marginBottom: "14px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
            color: "#374151", marginBottom: "8px", fontWeight: 500 }}>
            📍 Locating addresses… {progress.done}/{progress.total}
          </div>
          <div style={{ height: "5px", background: "#f3f4f6", borderRadius: "99px", overflow: "hidden" }}>
            <div style={{
              height: "100%", background: "#C4541A", borderRadius: "99px",
              width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : "0%",
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}

      {/* Map container */}
      {!leafletReady ? (
        <div style={{ height: "520px", background: "#f9fafb", borderRadius: "16px",
          border: "1.5px solid #e4e7ec", display: "flex", alignItems: "center",
          justifyContent: "center" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            color: "#9ca3af" }}>Loading map library…</div>
        </div>
      ) : (
        <div ref={mapContainerRef}
          style={{ height: "520px", borderRadius: "16px", overflow: "hidden",
            border: "1.5px solid #e4e7ec", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }} />
      )}

      {/* Walker summary */}
      {walkersWithAddr.length > 0 && (
        <div style={{ marginTop: "16px", background: "#fff", border: "1.5px solid #e4e7ec",
          borderRadius: "14px", padding: "16px 20px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700,
            letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af",
            marginBottom: "12px" }}>Walker Locations</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {walkersWithAddr.map(({ w, prof, addr }) => {
              const mapped = geoCache[addr];
              return (
                <div key={w.id} style={{ display: "flex", alignItems: "center", gap: "8px",
                  background: mapped === undefined ? "#f9fafb" : mapped ? "#FDF5EC" : "#fef2f2",
                  border: `1.5px solid ${mapped === undefined ? "#e4e7ec" : mapped ? "#F0E8D5" : "#fecaca"}`,
                  borderRadius: "9px", padding: "8px 12px" }}>
                  <span style={{ fontSize: "16px" }}>{w.avatar}</span>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      fontWeight: 600, color: "#111827" }}>{prof.preferredName || w.name}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                      color: mapped === undefined ? "#9ca3af" : mapped ? "#059669" : "#dc2626" }}>
                      {mapped === undefined ? "Locating…" : mapped ? "📍 Pinned" : "⚠️ Address not found"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {dayBookings.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px", background: "#fff",
          borderRadius: "14px", border: "1.5px solid #e4e7ec", marginTop: "16px" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>🗺️</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
            fontWeight: 600, color: "#374151", marginBottom: "4px" }}>No walks scheduled this day</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>
            Pick a different date or schedule some walks first.
          </div>
        </div>
      )}
    </div>
  );
}


export default AdminMapView;
