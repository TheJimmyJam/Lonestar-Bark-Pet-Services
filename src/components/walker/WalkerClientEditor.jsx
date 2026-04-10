import { useState, useEffect, useRef } from "react";
import { saveClients, notifyAdmin } from "../../supabase.js";
import { formatPhone, addrToString, addrFromString, emptyAddr, firstName } from "../../helpers.js";
import AddressFields from "../shared/AddressFields.jsx";

// ─── Walker Client Editor (keyholder clients) ─────────────────────────────────
function WalkerClientEditor({ client, clients, setClients, accentBlue }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState({
    phone: client.phone || "",
    addrObj: addrFromString(client.address || ""),
    dogs: (client.dogs || []).length > 0 ? [...client.dogs] : [""],
    cats: client.cats ? [...client.cats] : [],
    notes: client.notes || "",
  });

  const fieldStyle = {
    width: "100%", padding: "10px 13px", borderRadius: "9px",
    border: "1.5px solid #C8E4E8", background: "#fff",
    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
    color: "#111827", outline: "none",
  };
  const readStyle = { ...fieldStyle, background: "#f9fafb", color: "#6b7280", pointerEvents: "none" };
  const labelStyle = {
    display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
    fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
    color: "#9ca3af", marginBottom: "5px",
  };

  const handleSave = () => {
    const validDogs = draft.dogs.map(d => d.trim()).filter(Boolean);
    const validCats = draft.cats.map(c => c.trim()).filter(Boolean);
    const updated = {
      ...client,
      phone: draft.phone.trim(),
      address: addrToString(draft.addrObj),
      addrObj: draft.addrObj,
      dogs: validDogs,
      cats: validCats,
      notes: draft.notes.trim(),
    };
    setClients({ ...clients, [client.id]: updated });
    saveClients({ ...clients, [client.id]: updated });
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleCancel = () => {
    setEditing(false);
    setDraft({
      phone: client.phone || "",
      addrObj: addrFromString(client.address || ""),
      dogs: (client.dogs || []).length > 0 ? [...client.dogs] : [""],
      cats: client.cats ? [...client.cats] : [],
      notes: client.notes || "",
    });
  };

  const dogs = client.dogs || [];
  const cats = client.cats || [];
  const allPets = [...dogs, ...cats];
  const addressStr = client.address || addrToString(draft.addrObj) || "";
  const upcomingCount = (client.bookings || []).filter(b => !b.cancelled && !b.adminCompleted).length;

  return (
    <div style={{ background: "#fff", border: expanded ? `2px solid ${accentBlue}` : `1.5px solid ${accentBlue}22`,
      borderRadius: "14px", marginBottom: "12px", overflow: "hidden",
      boxShadow: expanded ? `0 4px 18px ${accentBlue}12` : "none",
      transition: "all 0.15s" }}>

      {/* ── Collapsed header (always visible, clickable to expand) ── */}
      <button
        onClick={() => { setExpanded(e => !e); if (editing) { setEditing(false); handleCancel(); } }}
        style={{ width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: "14px 18px", textAlign: "left", display: "block" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          {/* Avatar */}
          <div style={{ width: "42px", height: "42px", borderRadius: "50%", flexShrink: 0,
            background: `${accentBlue}12`, border: `1.5px solid ${accentBlue}30`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>
            {allPets.length > 0 ? "🐾" : "👤"}
          </div>
          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap", marginBottom: "3px" }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                fontSize: "16px", color: "#111827" }}>{client.name}</span>
              <span style={{ fontSize: "16px", background: `${accentBlue}12`,
                color: accentBlue, border: `1px solid ${accentBlue}33`,
                borderRadius: "5px", padding: "1px 7px",
                fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>🗝️ keyholder</span>
              {upcomingCount > 0 && (
                <span style={{ fontSize: "16px", background: "#FDF5EC", color: "#059669",
                  border: "1px solid #EDD5A8", borderRadius: "5px", padding: "1px 7px",
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
                  {upcomingCount} upcoming
                </span>
              )}
            </div>
            {allPets.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "3px" }}>
                {dogs.map((d, i) => (
                  <span key={i} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#059669", background: "#FDF5EC", border: "1px solid #EDD5A8",
                    borderRadius: "5px", padding: "1px 7px" }}>🐕 {d}</span>
                ))}
                {cats.map((c, i) => (
                  <span key={i} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    color: "#3D6B7A", background: "#EBF4F6", border: "1px solid #8ECAD4",
                    borderRadius: "5px", padding: "1px 7px" }}>🐈 {c}</span>
                ))}
              </div>
            ) : (
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#d1d5db" }}>
                No pets on file
              </div>
            )}
            {addressStr && (
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                📍 {addressStr}
              </div>
            )}
          </div>
          {/* Chevron */}
          <div style={{ fontSize: "15px", color: expanded ? accentBlue : "#d1d5db", flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s, color 0.2s" }}>
            ⌄
          </div>
        </div>
      </button>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div className="fade-up" style={{ borderTop: `1px solid ${accentBlue}18` }}>

          {/* Action bar */}
          <div style={{ padding: "12px 18px", display: "flex", alignItems: "center",
            justifyContent: "space-between", background: `${accentBlue}06` }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              color: "#9ca3af" }}>{client.email}</div>
            {!editing ? (
              <button onClick={() => setEditing(true)}
                style={{ padding: "6px 16px", borderRadius: "8px",
                  border: `1.5px solid ${accentBlue}44`, background: `${accentBlue}10`,
                  color: accentBlue, fontFamily: "'DM Sans', sans-serif",
                  fontSize: "16px", fontWeight: 600, cursor: "pointer" }}>
                ✏️ Edit
              </button>
            ) : (
              <div style={{ display: "flex", gap: "7px" }}>
                <button onClick={handleSave}
                  style={{ padding: "6px 16px", borderRadius: "8px", border: "none",
                    background: accentBlue, color: "#fff",
                    fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    fontWeight: 600, cursor: "pointer" }}>✓ Save</button>
                <button onClick={handleCancel}
                  style={{ padding: "6px 12px", borderRadius: "8px",
                    border: "1.5px solid #e4e7ec", background: "#fff",
                    color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "16px", cursor: "pointer" }}>Cancel</button>
              </div>
            )}
          </div>

          {saved && (
            <div style={{ padding: "10px 18px", background: "#FDF5EC", borderBottom: "1px solid #D4A87A",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#C4541A" }}>
              ✓ {client.name}'s profile updated.
            </div>
          )}

          {/* Fields */}
          <div style={{ padding: "16px 18px" }}>
            {/* Phone */}
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Phone Number</label>
              <input type="tel" value={draft.phone}
                onChange={e => setDraft(d => ({ ...d, phone: formatPhone(e.target.value) }))}
                placeholder="214.555.0000"
                maxLength={12}
                style={editing ? fieldStyle : readStyle}
                readOnly={!editing}
                onFocus={e => { if (editing) e.target.style.borderColor = accentBlue; }}
                onBlur={e => e.target.style.borderColor = "#C8E4E8"} />
            </div>

            {/* Address */}
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Home Address</label>
              {editing ? (
                <AddressFields value={draft.addrObj}
                  onChange={obj => setDraft(d => ({ ...d, addrObj: obj }))}
                  inputBaseStyle={{ padding: "10px 13px", fontSize: "15px" }}
                  labelBaseStyle={{ fontSize: "16px", color: "#9ca3af" }} />
              ) : (
                <div style={{ ...readStyle, padding: "10px 13px" }}>
                  {addrToString(draft.addrObj) || "No address on file"}
                </div>
              )}
            </div>

            {/* Dogs */}
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Dogs 🐕</label>
              {draft.dogs.map((dog, i) => (
                <div key={i} style={{ display: "flex", gap: "7px", marginBottom: "7px", alignItems: "center" }}>
                  <input value={dog}
                    onChange={e => editing && setDraft(d => ({ ...d, dogs: d.dogs.map((x, j) => j === i ? e.target.value : x) }))}
                    placeholder={`Dog ${i + 1}`}
                    style={editing ? { ...fieldStyle, flex: 1 } : { ...readStyle, flex: 1 }}
                    readOnly={!editing}
                    onFocus={e => { if (editing) e.target.style.borderColor = accentBlue; }}
                    onBlur={e => e.target.style.borderColor = "#C8E4E8"} />
                  {editing && draft.dogs.length > 1 && (
                    <button onClick={() => setDraft(d => ({ ...d, dogs: d.dogs.filter((_, j) => j !== i) }))}
                      style={{ width: "32px", height: "32px", borderRadius: "7px",
                        border: "1.5px solid #fecaca", background: "#fef2f2",
                        color: "#dc2626", cursor: "pointer", fontSize: "15px", flexShrink: 0 }}>✕</button>
                  )}
                </div>
              ))}
              {editing && (
                <button onClick={() => setDraft(d => ({ ...d, dogs: [...d.dogs, ""] }))}
                  style={{ marginTop: "2px", padding: "5px 12px", borderRadius: "7px",
                    border: `1.5px solid ${accentBlue}44`, background: `${accentBlue}08`,
                    color: accentBlue, fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", fontWeight: 500, cursor: "pointer" }}>+ Add Dog</button>
              )}
            </div>

            {/* Cats */}
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Cats 🐈</label>
              {draft.cats.length === 0 && !editing && (
                <div style={{ ...readStyle, padding: "10px 13px", fontStyle: "italic", color: "#d1d5db" }}>None on file</div>
              )}
              {draft.cats.map((cat, i) => (
                <div key={i} style={{ display: "flex", gap: "7px", marginBottom: "7px", alignItems: "center" }}>
                  <input value={cat}
                    onChange={e => editing && setDraft(d => ({ ...d, cats: d.cats.map((x, j) => j === i ? e.target.value : x) }))}
                    placeholder={`Cat ${i + 1}`}
                    style={editing ? { ...fieldStyle, flex: 1 } : { ...readStyle, flex: 1 }}
                    readOnly={!editing}
                    onFocus={e => { if (editing) e.target.style.borderColor = accentBlue; }}
                    onBlur={e => e.target.style.borderColor = "#C8E4E8"} />
                  {editing && (
                    <button onClick={() => setDraft(d => ({ ...d, cats: d.cats.filter((_, j) => j !== i) }))}
                      style={{ width: "32px", height: "32px", borderRadius: "7px",
                        border: "1.5px solid #fecaca", background: "#fef2f2",
                        color: "#dc2626", cursor: "pointer", fontSize: "15px", flexShrink: 0 }}>✕</button>
                  )}
                </div>
              ))}
              {editing && (
                <button onClick={() => setDraft(d => ({ ...d, cats: [...d.cats, ""] }))}
                  style={{ marginTop: "2px", padding: "5px 12px", borderRadius: "7px",
                    border: "1.5px solid #3D6B7A44", background: "#3D6B7A08",
                    color: "#3D6B7A", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "15px", fontWeight: 500, cursor: "pointer" }}>+ Add Cat</button>
              )}
            </div>

            {/* Notes */}
            <div>
              <label style={labelStyle}>Special Instructions</label>
              {editing ? (
                <textarea value={draft.notes}
                  onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                  rows={3} placeholder="Leash preferences, medications, entry codes, behavior notes…"
                  style={{ ...fieldStyle, resize: "vertical", lineHeight: "1.6" }}
                  onFocus={e => e.target.style.borderColor = accentBlue}
                  onBlur={e => e.target.style.borderColor = "#C8E4E8"} />
              ) : (
                <div style={{ ...readStyle, padding: "10px 13px", lineHeight: "1.6",
                  fontStyle: draft.notes ? "normal" : "italic",
                  color: draft.notes ? "#374151" : "#d1d5db" }}>
                  {draft.notes || "No special instructions"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default WalkerClientEditor;
