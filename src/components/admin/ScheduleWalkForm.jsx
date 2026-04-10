import { useState, useEffect, useRef, useMemo } from "react";
import { DAYS, FULL_DAYS, SERVICES, SERVICE_SLOTS } from "../../constants.js";
import { getAllWalkers } from "../auth/WalkerAuthScreen.jsx";
import { repriceWeekBookings } from "../../helpers.js";
import {
  saveClients, notifyAdmin, sendBookingConfirmation, sendWalkerBookingNotification,
  loadAllWalkersAvailability,
} from "../../supabase.js";
import {
  getWeekDates, getWeekBookingCountForOffset, getSessionPrice, getPriceTier,
  applySameDayDiscount, parseDateLocal, firstName, fmt, toDateKey,
} from "../../helpers.js";

// ─── Schedule Walk Form (Admin) ───────────────────────────────────────────────
function ScheduleWalkSection({ title, children }) {
  return (
    <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
      borderRadius: "14px", padding: "20px", marginBottom: "14px" }}>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px",
        letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af",
        marginBottom: "16px" }}>{title}</div>
      {children}
    </div>
  );
}

function ScheduleWalkForm({ clients, setClients, onDone, defaultWalker = "", doneLabel = "View in Bookings →", walkerProfiles = {}, allowHistorical = false, clientFilter = null, hideWalker = false }) {
  const TIME_SLOTS = [];
  for (let h = 7; h <= 19; h++) {
    for (const m of [0, 30]) {
      if (h === 19 && m === 30) break;
      const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const ampm = h < 12 ? "AM" : "PM";
      const label = `${h12}:${m === 0 ? "00" : "30"} ${ampm}`;
      TIME_SLOTS.push({ label, hour: h, minute: m, id: `${h}${m === 0 ? "0" : "30"}` });
    }
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const [isHistorical, setIsHistorical] = useState(false);
  const [customPrice, setCustomPrice]   = useState("");

  const blankForm = {
    clientId: "", service: "dog", date: todayStr,
    timeSlot: null, duration: "30 min", walker: defaultWalker, notes: "",
    pet: "", additionalDogs: [],
  };

  const [form, setForm]           = useState(blankForm);
  const [errors, setErrors]       = useState({});
  const [saved, setSaved]         = useState(false);
  const [savedInfo, setSavedInfo] = useState(null);
  const [walkerAvailability, setWalkerAvailability] = useState({});

  useEffect(() => {
    const start = toDateKey(getWeekDates(0)[0]);
    const end   = toDateKey(getWeekDates(16)[6]);
    loadAllWalkersAvailability(start, end).then(setWalkerAvailability);
  }, []);

  const amber = "#b45309";
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const selectedClient = form.clientId ? clients[form.clientId] : null;
  const clientDogs = selectedClient ? (selectedClient.dogs || selectedClient.pets || []) : [];
  const clientCats = selectedClient ? (selectedClient.cats || []) : [];
  const clientPets = [...clientDogs, ...clientCats];
  const relevantPets = form.service === "cat" ? clientCats : form.service === "overnight" ? clientPets : clientDogs;

  const calcPrice = () => {
    if (form.service === "overnight") return { price: 150, tier: "Overnight Stay", extraDogCharge: 0 };
    if (!selectedClient || !form.date) return { price: 30, tier: "Easy Rider", extraDogCharge: 0 };
    const apptDate = parseDateLocal(form.date);
    const dayOfWeek = apptDate.getDay();
    const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(apptDate);
    weekStart.setDate(apptDate.getDate() + offset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const existingCount = (selectedClient.bookings || []).filter(b => {
      if (b.cancelled || b.adminCompleted) return false;
      const d = new Date(b.scheduledDateTime || b.bookedAt);
      return d >= weekStart && d <= weekEnd;
    }).length;
    const totalCount = existingCount + 1;
    const priceTier = getPriceTier(totalCount);
    const extraDogCharge = form.additionalDogs.length * 10;
    return { price: (priceTier.prices[form.duration] || priceTier.prices["30 min"]) + extraDogCharge, tier: priceTier.label, extraDogCharge };
  };

  const { price, tier, extraDogCharge } = calcPrice();

  const validate = () => {
    const e = {};
    if (!form.clientId)  e.client = "Select a client";
    if (!form.date)      e.date   = "Required";
    if (!form.timeSlot && form.service !== "overnight") e.time = "Select a time";
    return e;
  };

  const handleSave = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    const client = clients[form.clientId];
    const apptDate = parseDateLocal(form.date);
    const slotHour   = form.timeSlot?.hour   ?? 20;
    const slotMinute = form.timeSlot?.minute ?? 0;
    apptDate.setHours(slotHour, slotMinute, 0, 0);

    const dateLabel = apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const dayIndex  = apptDate.getDay();
    const dayName   = FULL_DAYS[dayIndex === 0 ? 6 : dayIndex - 1];
    const allPets   = [...(client.dogs || client.pets || []), ...(client.cats || [])];
    const primaryPet = form.pet || allPets[0] || "";
    const additionalDogs = form.additionalDogs.filter(d => d && d !== primaryPet);
    const duration = form.service === "overnight" ? "1 Night" : form.duration;

    const bookingKey = `admin-${form.service}-${form.date}-${form.timeSlot?.id || "overnight"}-${Date.now()}`;
    const finalPrice = isHistorical && customPrice !== "" ? parseFloat(customPrice) || price : price;
    const scheduledISO = apptDate.toISOString();

    const newBooking = {
      key: bookingKey,
      service: form.service,
      day: dayName,
      date: dateLabel,
      slot: {
        id: form.timeSlot?.id || "overnight",
        time: form.timeSlot?.label || "—",
        duration,
        hour: slotHour,
        minute: slotMinute,
      },
      form: {
        name: client.name || "",
        pet: primaryPet,
        email: client.email || "",
        phone: client.phone || "",
        address: client.address || "",
        walker: form.walker,
        notes: form.notes,
        additionalDogs,
      },
      bookedAt: new Date().toISOString(),
      scheduledDateTime: scheduledISO,
      additionalDogCount: additionalDogs.length,
      additionalDogCharge: additionalDogs.length * 10,
      price: finalPrice,
      priceTier: tier,
      adminScheduled: true,
      // Historical walk fields
      ...(isHistorical && {
        adminCompleted: true,
        completedAt: scheduledISO,
        walkerMarkedComplete: true,
        isHistoricalEntry: true,
      }),
    };

    const updatedBookings = isHistorical
      ? [...(client.bookings || []), newBooking]
      : applySameDayDiscount(repriceWeekBookings([...(client.bookings || []), newBooking]));

    const updatedClients = {
      ...clients,
      [form.clientId]: { ...client, bookings: updatedBookings },
    };
    setClients(updatedClients);
    saveClients(updatedClients);
    // Send booking confirmation + notify admins
    if (!isHistorical) {
      sendBookingConfirmation({
        clientName: client.name,
        clientEmail: client.email,
        service: form.service,
        date: dateLabel,
        day: dayName,
        time: form.timeSlot?.label || "—",
        duration,
        walker: form.walker || "",
        price: finalPrice,
        pet: primaryPet,
      });
      const assignedWalker = getAllWalkers(walkerProfiles).find(w => w.name === form.walker);
      if (assignedWalker?.email) {
        sendWalkerBookingNotification({
          walkerName: assignedWalker.name,
          walkerEmail: assignedWalker.email,
          clientName: client.name,
          pet: primaryPet,
          service: form.service,
          date: dateLabel,
          day: dayName,
          time: form.timeSlot?.label || "—",
          duration,
          price: finalPrice,
        });
      }
      notifyAdmin("new_booking", {
        clientName: client.name,
        pet: primaryPet,
        date: dateLabel,
        time: form.timeSlot?.label || "—",
        duration,
        walker: form.walker || "Unassigned",
        price: finalPrice,
      });
    }
    setSavedInfo({ clientName: client.name, pet: primaryPet, date: dateLabel,
      day: dayName, time: form.timeSlot?.label || "—", duration,
      price: finalPrice, tier, walker: form.walker, isHistorical });
    setSaved(true);
    setForm(blankForm);
    setCustomPrice("");
    setErrors({});
    // Scroll the portal's content pane back to the top
    const scrollPane = document.querySelector("[data-scroll-pane]");
    if (scrollPane) {
      scrollPane.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const iStyle = (err) => ({
    width: "100%", padding: "11px 14px", borderRadius: "10px",
    border: `1.5px solid ${err ? "#ef4444" : "#e4e7ec"}`,
    background: "#fff", fontFamily: "'DM Sans', sans-serif",
    fontSize: "15px", color: "#111827", outline: "none",
  });
  const labelStyle = {
    display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
    fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
    color: "#9ca3af", marginBottom: "6px",
  };
  const errMsg = (key) => errors[key] ? (
    <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
      fontSize: "15px", marginTop: "4px" }}>{errors[key]}</div>
  ) : null;

  return (
    <div className="fade-up">
      {/* Mode toggle — admin only */}
      {allowHistorical && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {[
            { id: false, label: "📅 Upcoming Walk", desc: "Schedule a future walk" },
            { id: true,  label: "🕐 Historical Walk", desc: "Add a past or missed walk" },
          ].map(opt => (
            <button key={String(opt.id)} onClick={() => {
              setIsHistorical(opt.id);
              setForm(f => ({ ...f, date: opt.id ? "" : todayStr, timeSlot: null }));
              setCustomPrice("");
              setErrors({});
            }} style={{
              flex: 1, padding: "12px 14px", borderRadius: "12px", cursor: "pointer",
              border: isHistorical === opt.id ? "2px solid #b45309" : "1.5px solid #e4e7ec",
              background: isHistorical === opt.id ? "#fffbeb" : "#fff",
              textAlign: "left", transition: "all 0.15s",
            }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                fontSize: "14px", color: isHistorical === opt.id ? "#b45309" : "#374151",
                marginBottom: "2px" }}>{opt.label}</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                color: "#9ca3af" }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      )}

      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
        fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
        {isHistorical ? "Add Historical Walk" : "Schedule a Walk"}
      </div>
      <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
        marginBottom: "20px", lineHeight: "1.6" }}>
        {isHistorical
          ? "Add a past or missed walk to a client's record. It will be marked completed immediately. No invoice is generated."
          : "Book a walk on behalf of any client. Pricing auto-adjusts based on their walk count that week."}
      </p>

      {saved && savedInfo && (
        <div style={{ background: savedInfo.isHistorical ? "#fffbeb" : "#FDF5EC",
          border: `1.5px solid ${savedInfo.isHistorical ? "#fde68a" : "#F0E8D5"}`,
          borderRadius: "14px", padding: "16px 20px", marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
            <span style={{ fontSize: "20px" }}>{savedInfo.isHistorical ? "🕐" : "✅"}</span>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
              fontSize: "16px", color: savedInfo.isHistorical ? "#b45309" : "#059669" }}>
              {savedInfo.isHistorical ? "Historical walk added!" : "Walk scheduled!"}
            </div>
          </div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            color: "#374151", lineHeight: "1.8" }}>
            <strong>{savedInfo.clientName}</strong>{savedInfo.pet ? ` (${savedInfo.pet})` : ""} —{" "}
            {savedInfo.day}, {savedInfo.date} at {savedInfo.time} · {savedInfo.duration}
            {savedInfo.walker && <span> · 🦺 {savedInfo.walker}</span>}
            <br />
            <span style={{ color: savedInfo.isHistorical ? "#b45309" : "#059669", fontWeight: 600 }}>${savedInfo.price}</span>
            <span style={{ color: "#9ca3af" }}> · {savedInfo.tier}</span>
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
            <button onClick={() => { setSaved(false); setSavedInfo(null); }}
              style={{ padding: "8px 18px", borderRadius: "8px", border: "none",
                background: savedInfo.isHistorical ? "#b45309" : "#059669", color: "#fff",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                fontWeight: 600, cursor: "pointer" }}>+ Add Another</button>
            <button onClick={onDone}
              style={{ padding: "8px 16px", borderRadius: "8px",
                border: `1.5px solid ${savedInfo.isHistorical ? "#fde68a" : "#F0E8D5"}`,
                background: "#fff", color: savedInfo.isHistorical ? "#b45309" : "#059669",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                fontWeight: 500, cursor: "pointer" }}>{doneLabel}</button>
          </div>
        </div>
      )}

      {/* ── Admin Schedule Walk Form — two-column grid layout ── */}

      {/* Row 1: Client | Walker */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
        {/* Client */}
        <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "14px", padding: "18px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "13px",
            letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>Client *</div>
          <select value={form.clientId}
            onChange={e => {
              const cId = e.target.value;
              const c = cId ? clients[cId] : null;
              const dogs = c ? (c.dogs || c.pets || []) : [];
              const cats = c ? (c.cats || []) : [];
              setForm(f => ({ ...f, clientId: cId, pet: f.service === "cat" ? (cats[0] || "") : (dogs[0] || ""), additionalDogs: [] }));
            }}
            style={{ ...iStyle(errors.client), color: form.clientId ? "#111827" : "#9ca3af" }}>
            <option value="">— Choose a client —</option>
            {Object.values(clients)
              .filter(c => !clientFilter || clientFilter(c))
              .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
              .map(c => {
                const pets = [...(c.dogs || c.pets || []), ...(c.cats || [])];
                return (
                  <option key={c.id} value={c.id}>
                    {c.name || c.email}{pets.length > 0 ? ` — ${pets.join(", ")}` : ""}
                  </option>
                );
              })}
          </select>
          {errMsg("client")}
          {selectedClient && (
            <div style={{ marginTop: "10px", background: "#f9fafb", border: "1px solid #e4e7ec",
              borderRadius: "10px", padding: "10px 12px",
              fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#6b7280", lineHeight: "1.8" }}>
              {selectedClient.phone   && <div>📞 {selectedClient.phone}</div>}
              {selectedClient.address && <div>📍 {selectedClient.address}</div>}
              {clientPets.length > 0  && <div>🐾 {clientPets.join(", ")}</div>}
            </div>
          )}
        </div>

        {/* Walker */}
        {!hideWalker && (
        <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "14px", padding: "18px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "13px",
            letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>Walker</div>
          <select value={form.walker} onChange={e => setField("walker", e.target.value)}
            style={{ ...iStyle(false), color: form.walker ? "#111827" : "#9ca3af" }}>
            <option value="">— Assign later —</option>
            {getAllWalkers(walkerProfiles).map(w => {
              const hasAvailOnDate = form.date ? (walkerAvailability[w.id]?.[form.date] || []).length > 0 : true;
              return (
                <option key={w.id} value={w.name}>
                  {w.avatar} {firstName(w.name)}{!hasAvailOnDate && form.date ? " (no avail.)" : ""}
                </option>
              );
            })}
          </select>
          {form.walker && form.date && (() => {
            const w = getAllWalkers(walkerProfiles).find(w => w.name === form.walker);
            const slots = w ? (walkerAvailability[w.id]?.[form.date] || []) : [];
            if (slots.length === 0 && w) return (
              <div style={{ marginTop: "8px", padding: "8px 10px", background: "#fff7ed",
                border: "1.5px solid #fed7aa", borderRadius: "8px",
                fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#b45309" }}>
                ⚠️ {firstName(form.walker)} hasn't set availability for this date.
              </div>
            );
            return null;
          })()}
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "#9ca3af", marginTop: "6px" }}>
            Can also assign later from Assign Walks.
          </div>
        </div>
        )}
        {hideWalker && <div />}
      </div>

      {/* Row 2: Date | Duration */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
        {/* Date */}
        <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "14px", padding: "18px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "13px",
            letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>
            Date *{isHistorical && <span style={{ color: "#b45309", fontWeight: 400, fontSize: "12px", textTransform: "none", letterSpacing: 0, marginLeft: "6px" }}>any past date</span>}
          </div>
          <input type="date" value={form.date}
            {...(!isHistorical && { min: todayStr })}
            max={isHistorical ? todayStr : undefined}
            onChange={e => {
              const newDate = e.target.value;
              const now = new Date();
              const isNowToday = newDate === todayStr;
              const slotNowPast = !isHistorical && isNowToday && form.timeSlot && (
                form.timeSlot.hour < now.getHours() ||
                (form.timeSlot.hour === now.getHours() && form.timeSlot.minute <= now.getMinutes())
              );
              setForm(f => ({ ...f, date: newDate, timeSlot: slotNowPast ? null : f.timeSlot }));
            }}
            style={iStyle(errors.date)} />
          {errMsg("date")}
          {isHistorical && (
            <div style={{ marginTop: "10px" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "12px",
                letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "6px" }}>
                Price Override <span style={{ fontWeight: 400, fontSize: "12px", textTransform: "none", letterSpacing: 0 }}>(blank = ${price})</span>
              </div>
              <input type="number" min="0" step="1" value={customPrice}
                onChange={e => setCustomPrice(e.target.value)}
                placeholder={`${price}`} style={iStyle(false)} />
            </div>
          )}
        </div>

        {/* Duration */}
        <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "14px", padding: "18px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "13px",
            letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>Duration</div>
          {form.service !== "overnight" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[{ value: "30 min", label: "30 min", desc: "Quick walk" },
                { value: "60 min", label: "60 min", desc: "Full walk" }].map(opt => {
                const active = form.duration === opt.value;
                return (
                  <button key={opt.value} onClick={() => setField("duration", opt.value)} style={{
                    padding: "10px 12px", borderRadius: "10px", cursor: "pointer",
                    textAlign: "left", transition: "all 0.12s",
                    border: `1.5px solid ${active ? "#D4A843" : "#e4e7ec"}`,
                    background: active ? "#FDF5EC" : "#f9fafb",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      fontWeight: 700, color: active ? "#C4541A" : "#374151" }}>{opt.label}</span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                      color: active ? "#b45309" : "#9ca3af" }}>{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: "10px 12px", background: "#F7F0F5",
              borderRadius: "10px", border: "1.5px solid #E8D0E0",
              fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#7A4D6E", fontWeight: 600 }}>
              🌙 $150/night · flat rate
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Start Time | Pet */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
        {/* Start Time */}
        <div style={{ background: "#fff", border: `1.5px solid ${errors.time ? "#ef4444" : "#e4e7ec"}`, borderRadius: "14px", padding: "18px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "13px",
            letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>
            {form.service === "overnight" ? "Check-in Time" : "Start Time *"}
          </div>
          {errors.time && (
            <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
              fontSize: "14px", marginBottom: "8px" }}>{errors.time}</div>
          )}
          {(() => {
            const selectedWalkerObj = getAllWalkers(walkerProfiles).find(w => w.name === form.walker);
            const availSlotTimes = selectedWalkerObj && form.date
              ? (walkerAvailability[selectedWalkerObj.id]?.[form.date] || null)
              : null;
            const now = new Date();
            const visibleSlots = TIME_SLOTS.filter(slot => {
              if (!isHistorical && form.date === todayStr) {
                return !(slot.hour < now.getHours() ||
                  (slot.hour === now.getHours() && slot.minute <= now.getMinutes()));
              }
              return true;
            });
            return (
              <>
                <select value={form.timeSlot?.id || ""}
                  onChange={e => {
                    const slot = TIME_SLOTS.find(s => s.id === e.target.value);
                    setField("timeSlot", slot || null);
                    if (slot) setErrors(p => ({ ...p, time: "" }));
                  }}
                  style={{ ...iStyle(errors.time), color: form.timeSlot ? "#111827" : "#9ca3af" }}>
                  <option value="">{form.service === "overnight" ? "— Optional —" : "— Select time —"}</option>
                  {visibleSlots.map(slot => {
                    const walkerUnavailable = availSlotTimes !== null && !availSlotTimes.includes(slot.label);
                    return (
                      <option key={slot.id} value={slot.id} disabled={walkerUnavailable}>
                        {slot.label}{walkerUnavailable ? "  (unavailable)" : ""}
                      </option>
                    );
                  })}
                </select>
                {availSlotTimes !== null && availSlotTimes.length === 0 && (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                    color: "#b45309", marginTop: "8px", padding: "8px 10px",
                    background: "#fff7ed", borderRadius: "8px", border: "1px solid #fed7aa" }}>
                    ⚠️ {firstName(form.walker)} has no availability for this date.
                  </div>
                )}
                {form.date === todayStr && !isHistorical && (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                    color: "#9ca3af", marginTop: "5px" }}>
                    Past times are hidden.
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Pet */}
        <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "14px", padding: "18px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "13px",
            letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>
            {form.service === "cat" ? "Cat *" : form.service === "overnight" ? "Pet(s)" : "Dog(s) *"}
          </div>
          {selectedClient && relevantPets.length > 0 ? (
            form.service === "cat" ? (
              <select value={form.pet} onChange={e => setField("pet", e.target.value)} style={iStyle(false)}>
                <option value="">— Select cat —</option>
                {clientCats.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            ) : form.service === "overnight" ? (
              <select value={form.pet} onChange={e => setField("pet", e.target.value)} style={iStyle(false)}>
                <option value="">— Select pet —</option>
                {clientPets.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : (
              <>
                <select value={form.pet}
                  onChange={e => setForm(f => ({ ...f, pet: e.target.value, additionalDogs: f.additionalDogs.filter(d => d !== e.target.value) }))}
                  style={{ ...iStyle(false), marginBottom: clientDogs.length > 1 ? "10px" : 0 }}>
                  <option value="">— Select dog —</option>
                  {clientDogs.map(dog => <option key={dog} value={dog}>{dog}</option>)}
                </select>
                {clientDogs.length > 1 && (
                  <>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "12px",
                      letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af",
                      marginBottom: "6px" }}>
                      Additional <span style={{ color: "#b45309" }}>+$10 each</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {clientDogs.filter(dog => dog !== form.pet).map(dog => {
                        const checked = form.additionalDogs.includes(dog);
                        return (
                          <label key={dog} style={{ display: "flex", alignItems: "center", gap: "8px",
                            padding: "8px 10px", borderRadius: "8px", cursor: "pointer",
                            border: `1.5px solid ${checked ? amber : "#e4e7ec"}`,
                            background: checked ? `${amber}0d` : "#fff",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#111827" }}>
                            <input type="checkbox" checked={checked}
                              onChange={() => setForm(f => ({
                                ...f,
                                additionalDogs: checked
                                  ? f.additionalDogs.filter(d => d !== dog)
                                  : [...f.additionalDogs, dog],
                              }))}
                              style={{ width: "16px", height: "16px", accentColor: amber }} />
                            {dog}
                            {checked && <span style={{ marginLeft: "auto", color: amber, fontSize: "13px", fontWeight: 600 }}>+$10</span>}
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )
          ) : (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
              color: "#d1d5db", fontStyle: "italic" }}>
              {selectedClient ? "No pets on file." : "Select a client first."}
            </div>
          )}
        </div>
      </div>

      {/* Row 4: Service (full width) */}
      <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "14px", padding: "18px", marginBottom: "14px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "13px",
          letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "12px" }}>Service</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
          {[
            { id: "dog",       label: "Dog-walking",    icon: "🐕", color: "#C4541A", bg: "#FDF5EC", border: "#D4A843" },
            { id: "cat",       label: "Cat-sitting",    icon: "🐈", color: "#3D6B7A", bg: "#EBF4F6", border: "#8ECAD4" },
            { id: "overnight", label: "Overnight Stay", icon: "🌙", color: "#7A4D6E", bg: "#F7F0F5", border: "#E8D0E0" },
          ].map(svc => {
            const active = form.service === svc.id;
            const dogs = selectedClient ? (selectedClient.dogs || selectedClient.pets || []) : [];
            const cats = selectedClient ? (selectedClient.cats || []) : [];
            return (
              <button key={svc.id} onClick={() => setForm(f => ({
                ...f, service: svc.id,
                pet: svc.id === "cat" ? (cats[0] || "") : (dogs[0] || ""),
                additionalDogs: [],
                duration: svc.id === "overnight" ? "1 Night" : (f.duration === "1 Night" ? "30 min" : f.duration),
              }))} style={{
                padding: "14px 8px", borderRadius: "10px", cursor: "pointer",
                textAlign: "center", border: `1.5px solid ${active ? svc.border : "#e4e7ec"}`,
                background: active ? svc.bg : "#f9fafb", transition: "all 0.12s",
              }}>
                <div style={{ fontSize: "24px", marginBottom: "6px" }}>{svc.icon}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                  fontWeight: 600, color: active ? svc.color : "#6b7280" }}>{svc.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 5: Notes (full width) */}
      <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderRadius: "14px", padding: "18px", marginBottom: "14px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "13px",
          letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "10px" }}>Notes</div>
        <textarea value={form.notes} onChange={e => setField("notes", e.target.value)}
          placeholder="Gate code, pet instructions, special requests…"
          rows={3}
          style={{ ...iStyle(false), resize: "vertical", lineHeight: "1.6" }} />
      </div>

            {/* Pricing Preview */}
      {form.clientId && form.timeSlot && (
        <div style={{ background: `${amber}0c`, border: `1.5px solid ${amber}33`,
          borderRadius: "14px", padding: "16px 20px", marginBottom: "16px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
              fontSize: "15px", color: "#374151", marginBottom: "3px" }}>Pricing Preview</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af" }}>
              {selectedClient?.name}'s walk frequency this week · {form.duration}
              {extraDogCharge > 0 && <span style={{ color: amber }}> · +${extraDogCharge} extra dog{form.additionalDogs.length !== 1 ? "s" : ""}</span>}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: amber }}>${price}</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              color: "#9ca3af" }}>{tier}</div>
          </div>
        </div>
      )}

      <button onClick={handleSave} style={{
        width: "100%", padding: "16px", borderRadius: "12px", border: "none",
        background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
        fontSize: "15px", fontWeight: 600, cursor: "pointer",
        boxShadow: "0 6px 20px rgba(180,83,9,0.22)", letterSpacing: "0.3px",
      }}>Book Walk →</button>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af",
        textAlign: "center", marginTop: "10px" }}>
        Walk appears immediately in All Bookings and the client's upcoming walks.
      </div>
    </div>
  );
}


export default ScheduleWalkForm;
