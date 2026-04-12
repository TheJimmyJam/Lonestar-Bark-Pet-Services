import { useState } from "react";
import { addrFromString, addrToString, US_STATES } from "../../helpers.js";

function AddressFields({ value, onChange, errors = {}, inputBaseStyle = {}, labelBaseStyle = {} }) {
  const addr = (value && typeof value === "object") ? value : addrFromString(value || "");
  const [zipLooking, setZipLooking] = useState(false);
  const [zipError, setZipError] = useState("");
  const [autoFilled, setAutoFilled] = useState(!!(addr.city && addr.state));

  const baseInput = {
    width: "100%", padding: "12px 14px", borderRadius: "10px",
    background: "#fff", fontSize: "16px", fontFamily: "'DM Sans', sans-serif",
    color: "#111827", outline: "none", transition: "border-color 0.15s",
    ...inputBaseStyle,
  };
  const baseLabel = {
    display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
    fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase",
    color: "#9ca3af", marginBottom: "5px",
    ...labelBaseStyle,
  };
  const fieldBorder = (err) => `1.5px solid ${err ? "#ef4444" : "#d1d5db"}`;

  const update = (key, val) => {
    const next = { ...addr, [key]: val };
    onChange(next, addrToString(next));
  };

  const lookupZip = async (zip) => {
    if (zip.length !== 5) return;
    setZipLooking(true);
    setZipError("");
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!res.ok) throw new Error("not found");
      const data = await res.json();
      const city  = (data.places[0]["place name"] || "").toUpperCase();
      const state = data.places[0]["state abbreviation"] || "";
      const next = { ...addr, zip, city, state };
      onChange(next, addrToString(next));
      setAutoFilled(true);
    } catch {
      setZipError("ZIP not found — please enter city and state manually.");
      setAutoFilled(false);
    } finally {
      setZipLooking(false);
    }
  };

  return (
    <div>
      {/* ZIP Code — first */}
      <div style={{ marginBottom: "10px" }}>
        <label style={baseLabel}>ZIP Code</label>
        <div style={{ position: "relative" }}>
          <input
            value={addr.zip}
            onChange={e => {
              const zip = e.target.value.replace(/\D/g, "").slice(0, 5);
              update("zip", zip);
              setZipError("");
              if (zip.length < 5) setAutoFilled(false);
              if (zip.length === 5) lookupZip(zip);
            }}
            placeholder="75201"
            maxLength={5}
            inputMode="numeric"
            style={{ ...baseInput, border: fieldBorder(errors.zip || zipError),
              paddingRight: zipLooking ? "40px" : "14px" }}
          />
          {zipLooking && (
            <div style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
              fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
              …
            </div>
          )}
        </div>
        {(errors.zip || zipError) && (
          <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", marginTop: "3px" }}>{errors.zip || zipError}</div>
        )}
      </div>

      {/* City + State row — auto-filled from ZIP */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: "8px", marginBottom: "10px" }}>
        <div>
          <label style={baseLabel}>
            City
          </label>
          <input
            value={addr.city}
            onChange={e => update("city", e.target.value.toUpperCase())}
            placeholder="DALLAS"
            readOnly={autoFilled}
            style={{ ...baseInput, border: fieldBorder(errors.city),
              background: autoFilled ? "#f9fafb" : "#fff",
              color: "#111827", textTransform: "uppercase" }}
          />
          {errors.city && <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", marginTop: "3px" }}>{errors.city}</div>}
        </div>
        <div>
          <label style={baseLabel}>
            State
          </label>
          <input
            value={addr.state}
            onChange={e => update("state", e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase())}
            placeholder="TX"
            maxLength={2}
            readOnly={autoFilled}
            style={{ ...baseInput, border: fieldBorder(
              errors.state || (addr.state.length === 2 && !US_STATES.has(addr.state))
            ), background: autoFilled ? "#f9fafb" : "#fff" }}
          />
          {(errors.state || (addr.state.length === 2 && !US_STATES.has(addr.state))) && (
            <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", marginTop: "3px" }}>
              {errors.state || "Not a valid US state code"}
            </div>
          )}
        </div>
      </div>

      {/* Street */}
      <div style={{ marginBottom: "10px" }}>
        <label style={baseLabel}>Street Address</label>
        <input
          value={addr.street}
          onChange={e => update("street", e.target.value)}
          placeholder="123 Main St"
          style={{ ...baseInput, border: fieldBorder(errors.street) }}
        />
        {errors.street && <div style={{ color: "#ef4444", fontFamily: "'DM Sans', sans-serif",
          fontSize: "15px", marginTop: "3px" }}>{errors.street}</div>}
      </div>

      {/* Unit / Apt (optional) */}
      <div>
        <label style={baseLabel}>
          Unit / Apt <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0,
            fontSize: "13px", color: "#b0b7c3" }}>— optional</span>
        </label>
        <input
          value={addr.unit || ""}
          onChange={e => update("unit", e.target.value.replace(/[^a-zA-Z0-9#\- ]/g, "").slice(0, 10))}
          placeholder="e.g. 4B or 204"
          style={{ ...baseInput, border: fieldBorder(false) }}
        />
      </div>
    </div>
  );
}

export default AddressFields;
