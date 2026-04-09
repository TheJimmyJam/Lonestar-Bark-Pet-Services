import { useState, useEffect, useRef, useMemo } from "react";
import { FULL_DAYS, SERVICES, SERVICE_SLOTS } from "../../constants.js";
import { saveClients, loadAllWalkersAvailability } from "../../supabase.js";
import Header from "../shared/Header.jsx";
import { repriceWeekBookings } from "../../helpers.js";
import {
  getWeekDates, parseDateLocal, getWeekBookingCountForOffset,
  getSessionPrice, getPriceTier, applySameDayDiscount, firstName,
} from "../../helpers.js";

// ─── Quick Rebook Banner ──────────────────────────────────────────────────────
function QuickRebookBanner({ client, service, myBookings, clients, setClients, onBooked }) {
  const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ── Derive usual pattern for this service ──────────────────────────────────
  const usualRecs = useMemo(() => {
    const recs = (client.recurringSchedules || []).filter(r => r.service === service);
    if (recs.length > 0) return recs;
    // Fallback: find the most recent week that had bookings for this service
    const past = (myBookings || [])
      .filter(b => b.service === service && !b.cancelled && b.scheduledDateTime && new Date(b.scheduledDateTime) < new Date())
      .sort((a, b) => new Date(b.scheduledDateTime) - new Date(a.scheduledDateTime));
    if (past.length === 0) return [];
    // Identify the calendar week of the most recent booking
    const recent = new Date(past[0].scheduledDateTime);
    const jsDay  = recent.getDay();
    const toMon  = jsDay === 0 ? -6 : 1 - jsDay;
    const wMon   = new Date(recent); wMon.setDate(recent.getDate() + toMon); wMon.setHours(0,0,0,0);
    const wSun   = new Date(wMon);   wSun.setDate(wMon.getDate() + 6);       wSun.setHours(23,59,59,999);
    const weekBookings = past.filter(b => {
      const d = new Date(b.scheduledDateTime); return d >= wMon && d <= wSun;
    });
    return weekBookings.map((b, i) => {
      const d = new Date(b.scheduledDateTime);
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
      return {
        id: `past-${service}-${dow}-${b.slot?.id || i}`,
        service, dayOfWeek: dow,
        slotId: b.slot?.id || "",
        slotTime: b.slot?.time || "",
        duration: b.slot?.duration || "30 min",
        form: b.form || {},
        additionalDogCount: b.additionalDogCount || 0,
        _fromPast: true,
      };
    });
  }, [client.recurringSchedules, myBookings, service]);

  const patternKey = usualRecs.map(r => r.id).join(",");

  // ── Local state ────────────────────────────────────────────────────────────
  const [weekOffset, setWeekOffset] = useState(1);
  const [selected,   setSelected]   = useState(() => new Set(usualRecs.map(r => r.id)));
  const [submitting, setSubmitting] = useState(false);
  const [confirmed,  setConfirmed]  = useState(false);
  const [dismissed,  setDismissed]  = useState(false);

  useEffect(() => {
    setSelected(new Set(usualRecs.map(r => r.id)));
    setConfirmed(false);
    setWeekOffset(1);
  }, [service, patternKey]);

  if (usualRecs.length === 0 || dismissed) return null;

  // ── Compute per-entry state for the target week ────────────────────────────
  const wDates  = getWeekDates(weekOffset);
  const cutoff24h = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const entries = [...usualRecs]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map(rec => {
      const targetDate = new Date(wDates[rec.dayOfWeek]);
      const dateLabel  = targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const lastSlot   = new Date(targetDate); lastSlot.setHours(19, 0, 0, 0);
      const isPast     = lastSlot <= cutoff24h;
      const dateKey    = targetDate.toISOString().slice(0, 10);
      const alreadyBooked = myBookings.some(b =>
        !b.cancelled && b.scheduledDateTime?.slice(0, 10) === dateKey && b.service === service
      );
      return { ...rec, targetDate, dateLabel, isPast, alreadyBooked };
    });

  const bookableSelected = entries.filter(e => selected.has(e.id) && !e.alreadyBooked && !e.isPast);
  const displayEntries   = entries.filter(e => !e.alreadyBooked);
  const existingCount    = getWeekBookingCountForOffset(myBookings, weekOffset);
  const estimatedTotal   = bookableSelected.reduce((sum, e, i) =>
    sum + getSessionPrice(e.duration, existingCount + i + 1), 0);

  const mon        = wDates[0]; const sun = wDates[6];
  const weekLabel  = weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : `In ${weekOffset} weeks`;
  const rangeLabel = `${mon.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${sun.toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleQuickBook = () => {
    if (!bookableSelected.length) return;
    setSubmitting(true);
    setTimeout(() => {
      const freshDates = getWeekDates(weekOffset);
      const newBookings = bookableSelected.map(rec => {
        const apptDate = new Date(freshDates[rec.dayOfWeek]);
        const [timePart, meridiem] = (rec.slotTime || "10:00 AM").split(" ");
        let [hours, minutes] = timePart.split(":").map(Number);
        if (meridiem === "PM" && hours !== 12) hours += 12;
        if (meridiem === "AM" && hours === 12) hours = 0;
        apptDate.setHours(hours, minutes || 0, 0, 0);
        const slot = SERVICE_SLOTS.find(s => s.id === rec.slotId) ||
          { id: rec.slotId, time: rec.slotTime, duration: rec.duration };
        return {
          key: `${service}-${apptDate.toISOString().slice(0,10)}-${rec.slotId}-qr${Date.now()}`,
          service,
          day:  FULL_DAYS[rec.dayOfWeek],
          date: apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          slot: { ...slot, duration: rec.duration },
          form: {
            name: client.name || "", email: client.email || "", phone: client.phone || "",
            address: client.address || "", walker: client.preferredWalker || rec.form?.walker || "",
            pet: rec.form?.pet || "", notes: rec.form?.notes || "",
            additionalDogs: rec.form?.additionalDogs || [],
          },
          bookedAt: new Date().toISOString(),
          scheduledDateTime: apptDate.toISOString(),
          additionalDogCount: rec.additionalDogCount || 0,
          additionalDogCharge: (rec.additionalDogCount || 0) * 10,
          price: 0, priceTier: "",
          quickRebooked: true,
          recurringId: rec.id,
        };
      });
      const allBookings = applySameDayDiscount(repriceWeekBookings([...myBookings, ...newBookings]));
      const updated = { ...client, bookings: allBookings };
      const updatedClients = { ...clients, [client.id]: updated };
      setClients(updatedClients);
      saveClients(updatedClients);
      setSubmitting(false);
      setConfirmed(true);
      if (onBooked) onBooked();
    }, 800);
  };

  const toggleDay = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const resetForNextWeek = () => {
    setConfirmed(false);
    setWeekOffset(w => Math.min(w + 1, 8));
    setSelected(new Set(usualRecs.map(r => r.id)));
  };

  // ── Colours ────────────────────────────────────────────────────────────────
  const green = "#C4541A", lightGreen = "#FDF5EC", borderGreen = "#D4A843";
  const svcColor = service === "cat" ? "#3D6B7A" : "#C4541A";

  // ── Confirmed state ────────────────────────────────────────────────────────
  if (confirmed) return (
    <div style={{ background: lightGreen, border: `1.5px solid ${borderGreen}`,
      borderRadius: "14px", padding: "14px 18px", marginBottom: "20px",
      display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      <span style={{ fontSize: "20px" }}>✅</span>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: green, flex: 1, fontWeight: 500 }}>
        {bookableSelected.length} walk{bookableSelected.length !== 1 ? "s" : ""} booked for{" "}
        <strong>{rangeLabel}</strong>!
      </div>
      <button onClick={resetForNextWeek} style={{ background: "none", border: `1px solid ${borderGreen}`,
        borderRadius: "8px", color: green, cursor: "pointer", padding: "6px 12px",
        fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 500 }}>
        Book another week
      </button>
      <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none",
        color: "#9ca3af", cursor: "pointer", fontSize: "16px", padding: "2px" }}>✕</button>
    </div>
  );

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${borderGreen}`, borderRadius: "16px",
      padding: "18px 18px 16px", marginBottom: "20px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "14px" }}>
        <div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", textTransform: "uppercase", letterSpacing: "1.5px",
            fontWeight: 600, color: "#6b7280" }}>
            Repeat most recent schedule · tap to turn off days
          </div>
        </div>
        <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none",
          color: "#9ca3af", cursor: "pointer", fontSize: "16px", lineHeight: 1,
          padding: "2px", marginLeft: "8px", flexShrink: 0 }}>✕</button>
      </div>

      {/* Week navigator */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        <button
          onClick={() => { if (weekOffset > 0) { setWeekOffset(w => w - 1); setSelected(new Set(usualRecs.map(r => r.id))); } }}
          disabled={weekOffset === 0}
          style={{ width: "30px", height: "30px", borderRadius: "8px",
            border: "1.5px solid #e4e7ec", background: weekOffset === 0 ? "#f9fafb" : "#fff",
            color: weekOffset === 0 ? "#d1d5db" : "#374151",
            cursor: weekOffset === 0 ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>‹</button>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            fontWeight: 600, color: "#111827" }}>{weekLabel}</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
            color: "#9ca3af", marginTop: "1px" }}>{rangeLabel}</div>
        </div>
        <button
          onClick={() => { if (weekOffset < 8) { setWeekOffset(w => w + 1); setSelected(new Set(usualRecs.map(r => r.id))); } }}
          disabled={weekOffset >= 8}
          style={{ width: "30px", height: "30px", borderRadius: "8px",
            border: "1.5px solid #e4e7ec", background: weekOffset >= 8 ? "#f9fafb" : "#fff",
            color: weekOffset >= 8 ? "#d1d5db" : "#374151",
            cursor: weekOffset >= 8 ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>›</button>
      </div>

      {/* Day cards — match Select Date style */}
      {displayEntries.length === 0 ? (
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af",
          textAlign: "center", padding: "12px 0 16px", fontStyle: "italic" }}>
          All walks already booked for this week.
        </div>
      ) : (
        <div className="day-selector" style={{ marginBottom: "14px" }}>
          {displayEntries.map(entry => {
            const isSel    = selected.has(entry.id);
            const disabled = entry.isPast;
            return (
              <button key={entry.id} onClick={() => !disabled && toggleDay(entry.id)}
                disabled={disabled}
                style={{
                  minWidth: "52px", padding: "10px 6px", borderRadius: "10px",
                  border: isSel && !disabled ? `2px solid ${svcColor}` : "2px solid #e4e7ec",
                  background: isSel && !disabled ? svcColor : disabled ? "#f9fafb" : "#fff",
                  color: isSel && !disabled ? "#fff" : disabled ? "#d1d5db" : "#374151",
                  cursor: disabled ? "default" : "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
                  fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }}>
                <span style={{ fontSize: "16px", fontWeight: 600, textTransform: "uppercase" }}>
                  {SHORT[entry.dayOfWeek]}
                </span>
                <span style={{ fontSize: "17px", fontWeight: 700 }}>
                  {entry.targetDate.getDate()}
                </span>
                {entry.slotTime && (
                  <span style={{ fontSize: "11px", fontWeight: 500, opacity: 0.85, whiteSpace: "nowrap" }}>
                    {entry.slotTime}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: "10px", borderTop: "1px solid #f3f4f6", paddingTop: "14px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280" }}>
          {bookableSelected.length === 0
            ? <span style={{ color: "#9ca3af" }}>No walks selected</span>
            : <>
                <span style={{ fontWeight: 600, color: "#111827" }}>{bookableSelected.length}</span>
                {" walk"}{bookableSelected.length !== 1 ? "s" : ""} selected
                {" · "}
                <span style={{ fontWeight: 700, color: green }}>est. ${estimatedTotal}</span>
              </>}
        </div>
        <button onClick={handleQuickBook}
          disabled={!bookableSelected.length || submitting}
          style={{ padding: "10px 22px", borderRadius: "10px", border: "none",
            background: bookableSelected.length && !submitting ? green : "#e4e7ec",
            color: bookableSelected.length && !submitting ? "#fff" : "#9ca3af",
            fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
            cursor: bookableSelected.length && !submitting ? "pointer" : "default",
            transition: "all 0.2s ease" }}>
          {submitting
            ? "Booking…"
            : bookableSelected.length
              ? `Rebook These ${bookableSelected.length > 1 ? `${bookableSelected.length} Days` : "Day"} →`
              : "Select days to rebook"}
        </button>
      </div>
    </div>
  );
}


export default QuickRebookBanner;
