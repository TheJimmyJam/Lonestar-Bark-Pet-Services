import { useState, useEffect, useRef } from "react";
import { SERVICES, SERVICE_SLOTS, DAYS } from "../../constants.js";
import { saveClients, notifyAdmin } from "../../supabase.js";
import { addrToString, applySameDayDiscount, emptyAddr, firstName, fmt, formatPhone, generateCode, repriceWeekBookings } from "../../helpers.js";
import AddressFields from "../shared/AddressFields.jsx";
import { getAllWalkers } from "../auth/WalkerAuthScreen.jsx";
import { generateRecurringBookings } from "../recurring.js";

// ─── Add Legacy Client Form ──────────────────────────────────────────────────
function LegacySection({ title, children }) {
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

function AddLegacyClientForm({ clients, setClients, onDone, walkerProfiles = {}, lockedWalker = "" }) {
  const SCHEDULE_DAYS  = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const SCHEDULE_TIMES = [];
  for (let h = 7; h <= 19; h++) {
    for (const m of [0, 30]) {
      if (h === 19 && m === 30) break;
      const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const ampm = h < 12 ? "AM" : "PM";
      SCHEDULE_TIMES.push(`${h12}:${m === 0 ? "00" : "30"} ${ampm}`);
    }
  }

  const blank = {
    name: "", email: "", phone: "",
    addrObj: { street: "", city: "", state: "", zip: "" },
    dogs: [""], cats: [],
    preferredWalker: lockedWalker, notes: "",
    walkSchedule: null, preferredDuration: null,
    schedule: [], // [{ day, time, duration, service }]
  };
  const [form, setForm]         = useState(blank);
  const [errors, setErrors]     = useState({});
  const [saved, setSaved]       = useState(false);
  // schedule builder state
  const [schDay,  setSchDay]    = useState("");
  const [schTime, setSchTime]   = useState("");
  const [schDur,  setSchDur]    = useState("30 min");
  const [schSvc,  setSchSvc]    = useState("dog");

  const amber = "#b45309";

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
  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const validate = () => {
    const e = {};
    if (!form.name.trim())  e.name  = "Required";
    if (!form.email.trim() || !form.email.includes("@")) e.email = "Valid email required";
    if (Object.values(clients).some(c => c.email === form.email.trim().toLowerCase()))
      e.email = "Email already registered";
    const validDogs = form.dogs.map(d => d.trim()).filter(Boolean);
    const validCats = form.cats.map(c => c.trim()).filter(Boolean);
    if (validDogs.length === 0 && validCats.length === 0)
      e.pets = "Add at least one pet";
    return e;
  };

  const addScheduleEntry = () => {
    if (!schDay || !schTime) return;
    const entry = { day: schDay, time: schTime, duration: schDur, service: schSvc,
      id: `sched_${Date.now()}_${Math.random().toString(36).slice(2,7)}` };
    setForm(f => ({ ...f, schedule: [...f.schedule, entry] }));
  };

  const removeScheduleEntry = (id) =>
    setForm(f => ({ ...f, schedule: f.schedule.filter(s => s.id !== id) }));

  const handleSave = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    const validDogs = form.dogs.map(d => d.trim()).filter(Boolean);
    const validCats = form.cats.map(c => c.trim()).filter(Boolean);

    // Build recurring schedules from the schedule entries
    const dayIndex = { Monday:0,Tuesday:1,Wednesday:2,Thursday:3,Friday:4,Saturday:5,Sunday:6 };
    const recurringSchedules = form.schedule.map(s => ({
      id: s.id,
      service: s.service,
      dayOfWeek: dayIndex[s.day] ?? 0,
      slotId: s.time.replace(/[^0-9]/g, ""),
      slotTime: s.time,
      duration: s.duration,
      form: {
        name: form.name.trim(),
        pet: validDogs[0] || validCats[0] || "",
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        address: addrToString(form.addrObj),
        walker: form.preferredWalker,
        notes: form.notes,
        additionalDogs: [],
      },
      additionalDogCount: 0,
      createdAt: new Date().toISOString(),
      cancelledWeeks: [],
    }));

    const newClient = {
      id: `c_${Date.now()}`,
      email: form.email.trim().toLowerCase(),
      pin: null,
      mustSetPin: true,
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: addrToString(form.addrObj),
      dogs: validDogs,
      cats: validCats,
      preferredWalker: lockedWalker || form.preferredWalker,
      keyholder: lockedWalker || form.preferredWalker || "",
      notes: form.notes,
      walkSchedule: form.walkSchedule || null,
      preferredDuration: form.preferredDuration || null,
      recurringSchedules,
      handoffDone: true,   // legacy clients skip the meet & greet flow
      isLegacyClient: true,
      addedByWalker: !!lockedWalker,
      bookings: [],
      createdAt: new Date().toISOString(),
    };

    // Generate concrete upcoming bookings from recurring schedules
    if (recurringSchedules.length > 0) {
      const recurringBookings = generateRecurringBookings(recurringSchedules, newClient);
      newClient.bookings = applySameDayDiscount(repriceWeekBookings(recurringBookings));
    }

    const updated = { ...clients, [newClient.id]: newClient };
    setClients(updated);
    saveClients(updated);
    setSaved(true);
    setForm(blank);
    setErrors({});
    setTimeout(() => { setSaved(false); }, 3000);
  };

  return (
    <div className="fade-up">
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
        fontWeight: 600, color: "#111827", marginBottom: "4px" }}>Add Client</div>
      <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
        marginBottom: "20px", lineHeight: "1.6" }}>
        Create a client account on their behalf. They'll log in with the email and PIN you set here.
      </p>

      {saved && (
        <div style={{ background: "#FDF5EC", border: "1.5px solid #EDD5A8", borderRadius: "12px",
          padding: "14px 18px", marginBottom: "16px", display: "flex",
          alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>✅</span>
          <div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
              fontSize: "15px", color: "#059669" }}>Client created successfully!</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              color: "#6b7280", marginTop: "2px" }}>
              They can now log in at the Customer portal.{" "}
              <button onClick={onDone} style={{ background: "none", border: "none",
                color: "#059669", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                fontSize: "16px", fontWeight: 600, padding: 0, textDecoration: "underline" }}>
                View in Clients →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Identity ── */}
      <LegacySection title="Client Identity">
        <div style={{ marginBottom: "14px" }}>
          <label style={labelStyle}>Full Name *</label>
          <input value={form.name} onChange={e => setField("name", e.target.value)}
            placeholder="Jane Smith"
            style={iStyle(errors.name)} />
          {errors.name && <div style={{ color: "#ef4444", fontSize: "15px",
            fontFamily: "'DM Sans', sans-serif", marginTop: "4px" }}>{errors.name}</div>}
        </div>

        <div style={{ marginBottom: "14px" }}>
          <label style={labelStyle}>Email Address *</label>
          <input type="email" value={form.email}
            onChange={e => setField("email", e.target.value)}
            placeholder="jane@email.com"
            style={iStyle(errors.email)} />
          {errors.email && <div style={{ color: "#ef4444", fontSize: "15px",
            fontFamily: "'DM Sans', sans-serif", marginTop: "4px" }}>{errors.email}</div>}
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            color: "#9ca3af", marginTop: "5px" }}>
            🔐 The client will set their own PIN on first login.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <label style={labelStyle}>Phone Number</label>
            <input type="tel" value={form.phone}
              onChange={e => setField("phone", formatPhone(e.target.value))}
              placeholder="214.555.0000"
              maxLength={12}
              style={iStyle(false)} />
          </div>
        </div>
        <div style={{ marginTop: "14px" }}>
          <label style={{ ...labelStyle, marginBottom: "8px" }}>Home Address</label>
          <AddressFields
            value={form.addrObj}
            onChange={(obj, str) => setForm(f => ({ ...f, addrObj: obj }))}
            inputBaseStyle={{ padding: "11px 14px", fontSize: "15px" }}
            labelBaseStyle={{ fontSize: "16px" }}
          />
        </div>
      </LegacySection>

      {/* ── Pets ── */}
      <LegacySection title="Pets *">
        {errors.pets && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px",
            padding: "8px 12px", marginBottom: "12px", fontFamily: "'DM Sans', sans-serif",
            fontSize: "16px", color: "#dc2626" }}>{errors.pets}</div>
        )}

        {/* Dogs */}
        <div style={{ marginBottom: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: "8px" }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>🐕 Dogs</label>
            <button onClick={() => setForm(f => ({ ...f, dogs: [...f.dogs, ""] }))}
              style={{ background: "none", border: "1px solid #e4e7ec", color: "#6b7280",
                borderRadius: "6px", padding: "3px 10px", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px" }}>+ Add Dog</button>
          </div>
          {form.dogs.map((dog, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "7px" }}>
              <input value={dog}
                onChange={e => setForm(f => ({ ...f, dogs: f.dogs.map((d, j) => j === i ? e.target.value : d) }))}
                placeholder={i === 0 ? "Dog's name" : `Dog ${i + 1}'s name`}
                style={{ ...iStyle(false), flex: 1 }} />
              {form.dogs.length > 1 && (
                <button onClick={() => setForm(f => ({ ...f, dogs: f.dogs.filter((_, j) => j !== i) }))}
                  style={{ padding: "8px 10px", borderRadius: "8px",
                    border: "1px solid #e4e7ec", background: "#fff",
                    color: "#9ca3af", cursor: "pointer", fontSize: "15px" }}>✕</button>
              )}
            </div>
          ))}
        </div>

        {/* Cats */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: "8px" }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>🐈 Cats</label>
            <button onClick={() => setForm(f => ({ ...f, cats: [...f.cats, ""] }))}
              style={{ background: "none", border: "1px solid #e4e7ec", color: "#6b7280",
                borderRadius: "6px", padding: "3px 10px", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px" }}>+ Add Cat</button>
          </div>
          {form.cats.length === 0 && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              color: "#d1d5db", fontStyle: "italic" }}>No cats added.</div>
          )}
          {form.cats.map((cat, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "7px" }}>
              <input value={cat}
                onChange={e => setForm(f => ({ ...f, cats: f.cats.map((c, j) => j === i ? e.target.value : c) }))}
                placeholder={i === 0 ? "Cat's name" : `Cat ${i + 1}'s name`}
                style={{ ...iStyle(false), flex: 1 }} />
              <button onClick={() => setForm(f => ({ ...f, cats: f.cats.filter((_, j) => j !== i) }))}
                style={{ padding: "8px 10px", borderRadius: "8px",
                  border: "1px solid #e4e7ec", background: "#fff",
                  color: "#9ca3af", cursor: "pointer", fontSize: "15px" }}>✕</button>
            </div>
          ))}
        </div>
      </LegacySection>

      {/* ── Service Preferences ── */}
      <LegacySection title="Service Preferences">
        <div style={{ marginBottom: "14px" }}>
          <label style={labelStyle}>Preferred Walker</label>
          {lockedWalker ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px",
              padding: "10px 13px", borderRadius: "9px",
              background: "#EBF4F6", border: "1.5px solid #3D6B7A33" }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                fontWeight: 600, color: "#3D6B7A" }}>{firstName(lockedWalker)}</span>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                color: "#3D6B7A", background: "#C8E4E8", border: "1px solid #3D6B7A33",
                borderRadius: "5px", padding: "1px 7px", fontWeight: 600 }}>🗝️ keyholder</span>
            </div>
          ) : (
            <select value={form.preferredWalker}
              onChange={e => setField("preferredWalker", e.target.value)}
              style={{ ...iStyle(false), color: form.preferredWalker ? "#111827" : "#9ca3af" }}>
              <option value="">— No preference —</option>
              {getAllWalkers(walkerProfiles).map(w => (
                <option key={w.id} value={w.name}>{w.avatar} {firstName(w.name)}</option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
          <div>
            <label style={labelStyle}>Walk Schedule</label>
            <select value={form.walkSchedule || ""}
              onChange={e => setField("walkSchedule", e.target.value || null)}
              style={{ ...iStyle(false), color: form.walkSchedule ? "#111827" : "#9ca3af" }}>
              <option value="">— Not set —</option>
              <option value="1x">Easy Rider (1×/week)</option>
              <option value="3x">Steady Stroll (3×/week)</option>
              <option value="5x">Full Gallop (5×/week)</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Preferred Duration</label>
            <select value={form.preferredDuration || ""}
              onChange={e => setField("preferredDuration", e.target.value || null)}
              style={{ ...iStyle(false), color: form.preferredDuration ? "#111827" : "#9ca3af" }}>
              <option value="">— Not set —</option>
              <option value="30 min">30 min</option>
              <option value="60 min">60 min</option>
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Internal Notes</label>
          <textarea value={form.notes} onChange={e => setField("notes", e.target.value)}
            placeholder="Special instructions, gate codes, pet quirks, etc."
            rows={3}
            style={{ ...iStyle(false), resize: "vertical", lineHeight: "1.6" }} />
        </div>
      </LegacySection>

      {/* ── Regular Schedule ── */}
      <LegacySection title="Regular Walk Schedule">
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#9ca3af",
          marginBottom: "16px", lineHeight: "1.6" }}>
          Add the days and times this client normally schedules walks. These are saved as their recurring schedule.
        </p>

        {/* Builder row */}
        <div style={{ background: "#f9fafb", borderRadius: "10px", padding: "14px 16px",
          marginBottom: "14px", display: "flex", flexWrap: "wrap", gap: "10px",
          alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 130px" }}>
            <label style={{ ...labelStyle, color: "#b0b8c4" }}>Day</label>
            <select value={schDay} onChange={e => setSchDay(e.target.value)}
              style={{ ...iStyle(false), width: "100%", background: "#fff" }}>
              <option value="">Day…</option>
              {SCHEDULE_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 110px" }}>
            <label style={{ ...labelStyle, color: "#b0b8c4" }}>Time</label>
            <select value={schTime} onChange={e => setSchTime(e.target.value)}
              style={{ ...iStyle(false), width: "100%", background: "#fff" }}>
              <option value="">Time…</option>
              {SCHEDULE_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 90px" }}>
            <label style={{ ...labelStyle, color: "#b0b8c4" }}>Duration</label>
            <select value={schDur} onChange={e => setSchDur(e.target.value)}
              style={{ ...iStyle(false), width: "100%", background: "#fff" }}>
              <option value="30 min">30 min</option>
              <option value="60 min">60 min</option>
            </select>
          </div>
          <div style={{ flex: "1 1 90px" }}>
            <label style={{ ...labelStyle, color: "#b0b8c4" }}>Service</label>
            <select value={schSvc} onChange={e => setSchSvc(e.target.value)}
              style={{ ...iStyle(false), width: "100%", background: "#fff" }}>
              <option value="dog">🐕 Dog Walk</option>
              <option value="cat">🐈 Cat Sit</option>
            </select>
          </div>
          <button
            onClick={addScheduleEntry}
            disabled={!schDay || !schTime}
            style={{
              padding: "11px 18px", borderRadius: "9px", border: "none",
              background: schDay && schTime ? amber : "#e5e7eb",
              color: schDay && schTime ? "#fff" : "#9ca3af",
              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              fontWeight: 600, cursor: schDay && schTime ? "pointer" : "default",
              flexShrink: 0, alignSelf: "flex-end",
            }}>
            + Add
          </button>
        </div>

        {/* Saved entries */}
        {form.schedule.length === 0 ? (
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
            color: "#d1d5db", fontStyle: "italic", textAlign: "center", padding: "12px" }}>
            No schedule entries yet — add times above.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
            {form.schedule.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center",
                gap: "10px", background: "#fff", border: "1.5px solid #e4e7ec",
                borderRadius: "9px", padding: "10px 14px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 600, color: "#111827", flex: 1 }}>
                  {s.day}
                  <span style={{ fontWeight: 400, color: "#6b7280" }}> · {s.time} · {s.duration}</span>
                  <span style={{ marginLeft: "8px", fontSize: "16px" }}>
                    {s.service === "dog" ? "🐕" : "🐈"}
                  </span>
                </div>
                <button onClick={() => removeScheduleEntry(s.id)}
                  style={{ background: "none", border: "none", color: "#d1d5db",
                    cursor: "pointer", fontSize: "15px", lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </LegacySection>

      {/* ── Save ── */}
      <button onClick={handleSave} style={{
        width: "100%", padding: "16px", borderRadius: "12px", border: "none",
        background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
        fontSize: "15px", fontWeight: 600, cursor: "pointer",
        boxShadow: "0 6px 20px rgba(180,83,9,0.25)", letterSpacing: "0.3px",
      }}>
        Create Client Account →
      </button>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af",
        textAlign: "center", marginTop: "10px", lineHeight: "1.6" }}>
        The client will skip the Meet & Greet flow and can log in immediately with their email + PIN.
      </div>
    </div>
  );
}



export default AddLegacyClientForm;
