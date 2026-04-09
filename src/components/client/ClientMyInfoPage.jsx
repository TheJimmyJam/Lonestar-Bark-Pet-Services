import { useState, useEffect, useRef, useMemo } from "react";
import { SERVICES } from "../../constants.js";
import { saveClients, notifyAdmin } from "../../supabase.js";
import { formatPhone, addrToString, addrFromString, emptyAddr, firstName } from "../../helpers.js";
import AddressFields from "../shared/AddressFields.jsx";
import PinPad from "../shared/PinPad.jsx";

// ─── Client My Info Page ──────────────────────────────────────────────────────
function MyInfoSection({ title, children }) {
  return (
    <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
      borderRadius: "14px", padding: "20px", marginBottom: "12px" }}>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
        fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
        color: "#9ca3af", marginBottom: "16px" }}>{title}</div>
      {children}
    </div>
  );
}

function ClientMyInfoPage({ client, clients, setClients }) {
  const green = "#C4541A";
  const [infoSaved, setInfoSaved] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);

  const defaultDraft = () => ({
    name: client.name || "",
    email: client.email || "",
    phone: client.phone || "",
    addrObj: addrFromString(client.addrObj || client.address || ""),
    dogs: Array.isArray(client.dogs) && client.dogs.length > 0 ? [...client.dogs] : [""],
    cats: Array.isArray(client.cats) && client.cats.length > 0 ? [...client.cats] : [],
    notes: client.notes || "",
    vetName: client.vetName || "",
    vetAddress: client.vetAddress || "",
    vetPhone: client.vetPhone || "",
  });

  const [draft, setDraft] = useState(defaultDraft);
  const [pinSection, setPinSection] = useState("idle");
  const [pinError, setPinError] = useState("");
  const [newPinTemp, setNewPinTemp] = useState("");

  // Dirty check — compare draft to live client
  const isDirty = useMemo(() => {
    if (draft.name !== (client.name || "")) return true;
    if (draft.email !== (client.email || "")) return true;
    if (draft.phone !== (client.phone || "")) return true;
    const clientAddr = typeof client.address === "string" ? client.address : addrToString(client.addrObj || client.address || "");
    if (addrToString(draft.addrObj) !== (clientAddr || "")) return true;
    if (draft.notes !== (client.notes || "")) return true;
    if (draft.vetName !== (client.vetName || "")) return true;
    if (draft.vetAddress !== (client.vetAddress || "")) return true;
    if (draft.vetPhone !== (client.vetPhone || "")) return true;
    const dogs = draft.dogs.map(d => d.trim()).filter(Boolean);
    const cats = draft.cats.map(c => c.trim()).filter(Boolean);
    const clientDogs = Array.isArray(client.dogs) ? client.dogs : [];
    const clientCats = Array.isArray(client.cats) ? client.cats : [];
    if (JSON.stringify(dogs) !== JSON.stringify(clientDogs)) return true;
    if (JSON.stringify(cats) !== JSON.stringify(clientCats)) return true;
    return false;
  }, [draft, client]);

  // Scroll/navigation guard
  useEffect(() => {
    const handler = (e) => { if (isDirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const labelStyle = useMemo(() => ({
    display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
    fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase",
    color: "#9ca3af", marginBottom: "6px",
  }), []);

  const fieldStyle = useMemo(() => ({
    width: "100%", padding: "11px 14px", borderRadius: "10px",
    border: "1.5px solid #d1d5db", background: "#fff",
    fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
    color: "#111827", outline: "none", boxSizing: "border-box",
  }), []);

  const handleSave = () => {
    const validDogs = draft.dogs.map(d => d.trim()).filter(Boolean);
    const validCats = draft.cats.map(c => c.trim()).filter(Boolean);
    const updated = {
      ...client,
      name: draft.name.trim() || client.name,
      email: draft.email.trim().toLowerCase() || client.email,
      phone: draft.phone.trim(),
      address: addrToString(draft.addrObj),
      addrObj: draft.addrObj,
      dogs: validDogs,
      cats: validCats,
      notes: draft.notes.trim(),
      vetName: draft.vetName.trim(),
      vetAddress: draft.vetAddress.trim(),
      vetPhone: draft.vetPhone.trim(),
    };
    setClients({ ...clients, [client.id]: updated });
    saveClients({ ...clients, [client.id]: updated });
    setInfoSaved(true);
    setTimeout(() => setInfoSaved(false), 3000);
  };

  const handleDiscard = () => {
    setDraft(defaultDraft());
    setShowUnsavedModal(false);
  };

  const handlePinOld = (pin) => {
    if (pin === client.pin) { setPinSection("enter-new"); setPinError(""); }
    else { setPinError("Incorrect PIN. Try again."); setTimeout(() => setPinError(""), 100); }
  };
  const handlePinNew = (pin) => { setNewPinTemp(pin); setPinSection("confirm-new"); };
  const handlePinConfirm = (pin) => {
    if (pin === newPinTemp) {
      const updated = { ...client, pin };
      setClients({ ...clients, [client.id]: updated });
      saveClients({ ...clients, [client.id]: updated });
      setPinSection("done"); setPinError("");
    } else {
      setPinError("PINs don't match. Start over.");
      setTimeout(() => setPinError(""), 100);
      setNewPinTemp(""); setPinSection("enter-new");
    }
  };

  return (
    <div className="app-container fade-up">

      {/* Unsaved changes modal */}
      {showUnsavedModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ background: "#fff", borderRadius: "18px", padding: "28px 24px",
            maxWidth: "360px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: "32px", textAlign: "center", marginBottom: "12px" }}>⚠️</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600,
              color: "#111827", textAlign: "center", marginBottom: "8px" }}>Unsaved Changes</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              color: "#6b7280", textAlign: "center", lineHeight: "1.6", marginBottom: "24px" }}>
              You have unsaved changes. Save before leaving or they'll be lost.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button onClick={() => { handleSave(); setShowUnsavedModal(false); }} style={{
                width: "100%", padding: "13px", borderRadius: "10px", border: "none",
                background: green, color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
                Save Changes
              </button>
              <button onClick={handleDiscard} style={{
                width: "100%", padding: "13px", borderRadius: "10px",
                border: "1.5px solid #e4e7ec", background: "#fff",
                color: "#6b7280", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", cursor: "pointer" }}>
                Discard Changes
              </button>
              <button onClick={() => setShowUnsavedModal(false)} style={{
                width: "100%", padding: "13px", borderRadius: "10px",
                border: "none", background: "none",
                color: "#9ca3af", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", cursor: "pointer" }}>
                Keep Editing
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
          fontWeight: 600, color: "#111827" }}>My Info</div>
        {isDirty && (
          <button onClick={handleSave} style={{ padding: "8px 20px", borderRadius: "8px", border: "none",
            background: green, color: "#fff", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
            ✓ Save Changes
          </button>
        )}
      </div>

      {infoSaved && (
        <div className="fade-up" style={{ background: "#FDF5EC", border: "1.5px solid #D4A87A",
          borderRadius: "10px", padding: "10px 14px", marginBottom: "16px",
          fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: green }}>
          ✓ Profile updated successfully.
        </div>
      )}

      {isDirty && !infoSaved && (
        <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a",
          borderRadius: "10px", padding: "10px 14px", marginBottom: "16px",
          fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#92400e",
          display: "flex", alignItems: "center", gap: "8px" }}>
          <span>✏️</span> You have unsaved changes — tap Save Changes to keep them.
        </div>
      )}

      <MyInfoSection title="Personal Info">
        <div style={{ marginBottom: "12px" }}>
          <label style={labelStyle}>Full Name</label>
          <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            style={fieldStyle}
            onFocus={e => e.target.style.borderColor = green}
            onBlur={e => e.target.style.borderColor = "#d1d5db"} />
        </div>
        <div style={{ marginBottom: "12px" }}>
          <label style={labelStyle}>Email Address</label>
          <input type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
            style={fieldStyle}
            onFocus={e => e.target.style.borderColor = green}
            onBlur={e => e.target.style.borderColor = "#d1d5db"} />
        </div>
        <div>
          <label style={labelStyle}>Phone Number</label>
          <input type="tel" value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: formatPhone(e.target.value) }))}
            placeholder="214.555.0000" maxLength={12}
            style={fieldStyle}
            onFocus={e => e.target.style.borderColor = green}
            onBlur={e => e.target.style.borderColor = "#d1d5db"} />
        </div>
      </MyInfoSection>

      <MyInfoSection title="Home Address">
        <AddressFields value={draft.addrObj}
          onChange={(obj) => setDraft(d => ({ ...d, addrObj: obj }))}
          inputBaseStyle={{ padding: "11px 14px", fontSize: "16px" }} />
      </MyInfoSection>

      <MyInfoSection title="Vet Information 🏥">
        <div style={{ marginBottom: "12px" }}>
          <label style={labelStyle}>Vet Name</label>
          <input value={draft.vetName} onChange={e => setDraft(d => ({ ...d, vetName: e.target.value }))}
            placeholder="e.g. White Rock Animal Hospital"
            style={fieldStyle}
            onFocus={e => e.target.style.borderColor = green}
            onBlur={e => e.target.style.borderColor = "#d1d5db"} />
        </div>
        <div style={{ marginBottom: "12px" }}>
          <label style={labelStyle}>Vet Address</label>
          <input value={draft.vetAddress} onChange={e => setDraft(d => ({ ...d, vetAddress: e.target.value }))}
            placeholder="e.g. 1234 Mockingbird Ln, Dallas, TX 75214"
            style={fieldStyle}
            onFocus={e => e.target.style.borderColor = green}
            onBlur={e => e.target.style.borderColor = "#d1d5db"} />
        </div>
        <div>
          <label style={labelStyle}>Vet Phone</label>
          <input type="tel" value={draft.vetPhone} onChange={e => setDraft(d => ({ ...d, vetPhone: formatPhone(e.target.value) }))}
            placeholder="214.555.0000" maxLength={12}
            style={fieldStyle}
            onFocus={e => e.target.style.borderColor = green}
            onBlur={e => e.target.style.borderColor = "#d1d5db"} />
        </div>
      </MyInfoSection>

      <MyInfoSection title="Your Dogs 🐕">
        {draft.dogs.map((dog, i) => (
          <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
            <input value={dog}
              onChange={e => setDraft(d => ({ ...d, dogs: d.dogs.map((x, j) => j === i ? e.target.value : x) }))}
              placeholder={`Dog ${i + 1} name`}
              style={{ ...fieldStyle, flex: 1 }}
              onFocus={e => e.target.style.borderColor = green}
              onBlur={e => e.target.style.borderColor = "#d1d5db"} />
            {draft.dogs.length > 1 && (
              <button onClick={() => setDraft(d => ({ ...d, dogs: d.dogs.filter((_, j) => j !== i) }))}
                style={{ width: "34px", height: "34px", borderRadius: "8px", border: "1.5px solid #fecaca",
                  background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: "16px", flexShrink: 0 }}>✕</button>
            )}
          </div>
        ))}
        <button onClick={() => setDraft(d => ({ ...d, dogs: [...d.dogs, ""] }))}
          style={{ marginTop: "4px", padding: "7px 14px", borderRadius: "8px",
            border: `1.5px solid ${green}44`, background: `${green}08`,
            color: green, fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 500, cursor: "pointer" }}>
          + Add Dog
        </button>
      </MyInfoSection>

      <MyInfoSection title="Your Cats 🐈">
        {draft.cats.length === 0 && (
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
            color: "#d1d5db", fontStyle: "italic", marginBottom: "8px" }}>No cats on file</div>
        )}
        {draft.cats.map((cat, i) => (
          <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
            <input value={cat}
              onChange={e => setDraft(d => ({ ...d, cats: d.cats.map((x, j) => j === i ? e.target.value : x) }))}
              placeholder={`Cat ${i + 1} name`}
              style={{ ...fieldStyle, flex: 1 }}
              onFocus={e => e.target.style.borderColor = "#3D6B7A"}
              onBlur={e => e.target.style.borderColor = "#d1d5db"} />
            <button onClick={() => setDraft(d => ({ ...d, cats: d.cats.filter((_, j) => j !== i) }))}
              style={{ width: "34px", height: "34px", borderRadius: "8px", border: "1.5px solid #fecaca",
                background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: "16px", flexShrink: 0 }}>✕</button>
          </div>
        ))}
        <button onClick={() => setDraft(d => ({ ...d, cats: [...d.cats, ""] }))}
          style={{ marginTop: "4px", padding: "7px 14px", borderRadius: "8px",
            border: "1.5px solid #3D6B7A44", background: "#3D6B7A08",
            color: "#3D6B7A", fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 500, cursor: "pointer" }}>
          + Add Cat
        </button>
      </MyInfoSection>

      <MyInfoSection title="Notes for Walkers">
        <textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
          rows={3} placeholder="Leash preferences, allergies, entry instructions…"
          style={{ ...fieldStyle, resize: "vertical", lineHeight: "1.6" }}
          onFocus={e => e.target.style.borderColor = green}
          onBlur={e => e.target.style.borderColor = "#d1d5db"} />
      </MyInfoSection>
      <div style={{ background: "#fff", border: "1.5px solid #e4e7ec",
        borderRadius: "14px", padding: "20px", marginBottom: "32px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
          fontSize: "15px", letterSpacing: "1.5px", textTransform: "uppercase",
          color: "#9ca3af", marginBottom: "16px" }}>Change PIN</div>
        {pinSection === "idle" && (
          <button onClick={() => setPinSection("confirm-old")}
            style={{ padding: "10px 20px", borderRadius: "10px", border: "1.5px solid #e4e7ec",
              background: "#f9fafb", color: "#374151", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", fontWeight: 500, cursor: "pointer" }}>🔒 Change my PIN</button>
        )}
        {pinSection === "confirm-old" && (
          <div className="fade-up">
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280", marginBottom: "20px" }}>
              Enter your current PIN to continue.
            </p>
            <PinPad label="Current PIN" onComplete={handlePinOld} error={pinError} color={green} />
            <button onClick={() => { setPinSection("idle"); setPinError(""); }}
              style={{ marginTop: "16px", background: "none", border: "none", color: "#9ca3af",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer",
                display: "block", width: "100%", textAlign: "center" }}>Cancel</button>
          </div>
        )}
        {pinSection === "enter-new" && (
          <div className="fade-up">
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280", marginBottom: "20px" }}>
              Choose a new 6-digit PIN.
            </p>
            <PinPad label="New PIN" onComplete={handlePinNew} error={pinError} color={green} />
          </div>
        )}
        {pinSection === "confirm-new" && (
          <div className="fade-up">
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280", marginBottom: "20px" }}>
              Enter your new PIN one more time to confirm.
            </p>
            <PinPad label="Confirm New PIN" onComplete={handlePinConfirm} error={pinError} color={green} />
          </div>
        )}
        {pinSection === "done" && (
          <div className="fade-up" style={{ display: "flex", alignItems: "center", gap: "10px",
            background: "#FDF5EC", border: "1.5px solid #D4A87A", borderRadius: "10px", padding: "12px 16px" }}>
            <span style={{ fontSize: "18px" }}>✓</span>
            <div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                fontSize: "15px", color: green }}>PIN updated successfully.</div>
              <button onClick={() => setPinSection("idle")}
                style={{ background: "none", border: "none", color: "#9ca3af",
                  fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer", padding: 0, marginTop: "4px" }}>
                Change again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export default ClientMyInfoPage;
