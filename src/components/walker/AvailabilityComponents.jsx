import { useState, useRef } from "react";

// ─── Availability slider helpers & components ─────────────────────────────────
// ─── Availability slider helpers & components ─────────────────────────────────
const TAB_SLOTS = ["7:00 AM","7:30 AM","8:00 AM","8:30 AM","9:00 AM","9:30 AM","10:00 AM","10:30 AM",
  "11:00 AM","11:30 AM","12:00 PM","12:30 PM","1:00 PM","1:30 PM","2:00 PM","2:30 PM",
  "3:00 PM","3:30 PM","4:00 PM","4:30 PM","5:00 PM","5:30 PM","6:00 PM","6:30 PM","7:00 PM"];

// Convert an array of slot-time strings → array of {start,end} shift objects (inclusive indices)
function slotsToShifts(slots) {
  if (!slots || slots.length === 0) return [];
  const indices = slots.map(s => TAB_SLOTS.indexOf(s)).filter(i => i >= 0);
  indices.sort((a, b) => a - b);
  const shifts = [];
  let start = indices[0], prev = indices[0];
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] > prev + 1) { shifts.push({ start, end: prev }); start = indices[i]; }
    prev = indices[i];
  }
  shifts.push({ start, end: prev });
  return shifts;
}

// Convert array of {start,end} shifts → sorted slot-time strings
function shiftsToSlots(shifts) {
  const out = new Set();
  shifts.forEach(({ start, end }) => {
    for (let i = start; i <= end; i++) if (TAB_SLOTS[i]) out.add(TAB_SLOTS[i]);
  });
  return TAB_SLOTS.filter(t => out.has(t));
}

const AVAIL_SLIDER_CSS = `
  .avail-slider { -webkit-appearance: none; appearance: none; background: transparent;
    width: 100%; height: 100%; position: absolute; top: 0; left: 0; margin: 0; padding: 0;
    pointer-events: none; }
  .avail-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
    width: 22px; height: 22px; border-radius: 50%; cursor: pointer; pointer-events: auto;
    background: var(--thumb-color, #3D6B7A);
    border: 2.5px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,0.25); }
  .avail-slider::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%;
    cursor: pointer; pointer-events: auto; background: var(--thumb-color, #3D6B7A);
    border: 2.5px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,0.25); }
  .avail-slider::-webkit-slider-runnable-track { background: transparent; }
  .avail-slider::-moz-range-track { background: transparent; }
`;

function ShiftSlider({ shift, idx, onUpdate, onRemove, canRemove, color }) {
  const MAX = TAB_SLOTS.length - 1; // 24
  const { start, end } = shift;
  const pct = v => `${(v / MAX) * 100}%`;
  const slotCount = end - start + 1;
  // Approximate end-of-shift time (30 min after last slot start)
  const endTimeLabel = (() => {
    const lastSlot = TAB_SLOTS[end];
    const [timePart, mer] = lastSlot.split(" ");
    let [h, m] = timePart.split(":").map(Number);
    m += 30; if (m >= 60) { m -= 60; h += 1; }
    const newMer = h >= 12 && !(h === 12 && m === 0 && mer === "AM") ? "PM" : mer;
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:${m === 0 ? "00" : "30"} ${newMer}`;
  })();

  return (
    <div style={{ marginBottom: "20px" }}>
      {/* Time label row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "10px", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {idx > 0 && (
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              fontWeight: 700, color: "#9ca3af", letterSpacing: "1px",
              textTransform: "uppercase", marginRight: "2px" }}>Shift {idx + 1}</span>
          )}
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            fontWeight: 700, color: color }}>{TAB_SLOTS[start]}</span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
            color: "#9ca3af" }}>→</span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            fontWeight: 700, color: color }}>{endTimeLabel}</span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            color: "#9ca3af", background: "#f3f4f6", borderRadius: "10px",
            padding: "2px 7px" }}>{slotCount} slot{slotCount !== 1 ? "s" : ""}</span>
        </div>
        {canRemove && (
          <button onClick={onRemove} style={{ background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: "7px", padding: "3px 10px", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#dc2626",
            fontWeight: 500, flexShrink: 0 }}>× Remove</button>
        )}
      </div>

      {/* Dual-range slider track */}
      <div style={{ position: "relative", height: "28px", userSelect: "none" }}>
        {/* Track background */}
        <div style={{ position: "absolute", top: "50%", left: 0, right: 0,
          height: "5px", marginTop: "-2.5px", background: "#e4e7ec", borderRadius: "3px" }} />
        {/* Active fill */}
        <div style={{ position: "absolute", top: "50%", marginTop: "-2.5px", height: "5px",
          left: pct(start), width: `calc(${pct(end)} - ${pct(start)})`,
          background: color, borderRadius: "3px", transition: "left 0.05s, width 0.05s" }} />
        {/* Start thumb — lower z so end can always be grabbed; bump up at far right */}
        <input type="range" className="avail-slider" min={0} max={MAX} step={1} value={start}
          style={{ zIndex: start >= MAX - 1 ? 5 : 3,
            "--thumb-color": color } }
          onChange={e => onUpdate({ ...shift, start: Math.min(+e.target.value, end - 1) })} />
        {/* End thumb */}
        <input type="range" className="avail-slider" min={0} max={MAX} step={1} value={end}
          style={{ zIndex: 4, "--thumb-color": color }}
          onChange={e => onUpdate({ ...shift, end: Math.max(+e.target.value, start + 1) })} />
      </div>

      {/* Time marker ticks */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
        {["7 AM","9 AM","11 AM","1 PM","3 PM","5 PM","7 PM"].map(t => (
          <span key={t} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
            color: "#374151", letterSpacing: "0.3px" }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function DayAvailSliders({ slots, onChange, color, isPast }) {
  const shifts = slotsToShifts(slots);

  const update = (idx, newShift) =>
    onChange(shiftsToSlots(shifts.map((s, i) => i === idx ? newShift : s)));

  const remove = (idx) =>
    onChange(shiftsToSlots(shifts.filter((_, i) => i !== idx)));

  const add = () => {
    if (shifts.length === 0) { onChange(shiftsToSlots([{ start: 2, end: 14 }])); return; }
    const lastEnd = shifts[shifts.length - 1].end;
    const newStart = Math.min(lastEnd + 2, TAB_SLOTS.length - 3);
    const newEnd   = Math.min(newStart + 3, TAB_SLOTS.length - 1);
    if (newStart >= newEnd) return;
    onChange(shiftsToSlots([...shifts, { start: newStart, end: newEnd }]));
  };

  if (isPast) return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
      color: "#9ca3af", fontStyle: "italic" }}>Past date — no changes allowed</div>
  );

  return (
    <div>
      {shifts.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: "12px",
          padding: "14px 0", borderTop: "1px solid #f3f4f6" }}>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            color: "#9ca3af" }}>No availability set for this day.</span>
          <button onClick={add} style={{ background: `${color}12`, border: `1.5px solid ${color}40`,
            borderRadius: "8px", padding: "5px 14px", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color, fontWeight: 500 }}>
            + Set hours
          </button>
        </div>
      ) : (
        <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: "14px" }}>
          {shifts.map((shift, idx) => (
            <ShiftSlider key={idx} shift={shift} idx={idx}
              onUpdate={s => update(idx, s)}
              onRemove={() => remove(idx)}
              canRemove={shifts.length > 1}
              color={color} />
          ))}
          {shifts.length < 3 && (
            <button onClick={add} style={{ background: "none", border: `1.5px dashed ${color}50`,
              borderRadius: "8px", padding: "6px 16px", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: `${color}99`,
              fontWeight: 500, width: "100%", marginTop: "2px" }}>
              + Add break / another shift
            </button>
          )}
        </div>
      )}
    </div>
  );
}


export { slotsToShifts, shiftsToSlots, ShiftSlider, DayAvailSliders, AVAIL_SLIDER_CSS };
