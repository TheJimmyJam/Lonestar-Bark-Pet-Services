import { useState, useEffect, useRef } from "react";
import { WALKER_SERVICES } from "../../constants.js";
import { notifyAdmin } from "../../supabase.js";
import { formatPhone, emptyAddr, addrToString } from "../../helpers.js";
import LogoBadge from "../shared/LogoBadge.jsx";
import AddressFields from "../shared/AddressFields.jsx";

// ─── Walker Application Page ──────────────────────────────────────────────────
function WalkerApplicationPage({ onBack }) {
  const blank = {
    // Step 1 — Contact
    firstName: "", lastName: "", email: "", phone: "",
    zip: "", city: "", state: "", address: "",
    // Step 2 — Experience
    hasDogExp: null, expYears: "", expDesc: "",
    firstAid: false, petCpr: false, otherCerts: "",
    // Step 3 — References & Availability
    ref1Name: "", ref1Phone: "", ref1Rel: "",
    ref2Name: "", ref2Phone: "", ref2Rel: "",
    days: [], times: [], hoursPerWeek: "",
  };

  const [step, setStep]         = useState(1);
  const [form, setForm]         = useState(blank);
  const [errors, setErrors]     = useState({});
  const [submitting, setSubmit] = useState(false);
  const [done, setDone]         = useState(false);
  const [zipLookup, setZipLookup] = useState("idle"); // idle|loading|found|notfound

  const f  = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const clrErr = (...keys) => setErrors(p => { const n={...p}; keys.forEach(k=>delete n[k]); return n; });
  const toggleArr = (key, val) => setForm(p => ({
    ...p, [key]: p[key].includes(val) ? p[key].filter(v=>v!==val) : [...p[key], val],
  }));

  const inp = (err) => ({
    width: "100%", padding: "11px 14px", borderRadius: "10px", boxSizing: "border-box",
    border: `1.5px solid ${err ? "#ef4444" : "#e4e7ec"}`,
    fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
    color: "#111827", outline: "none", background: "#fff",
  });
  const lbl = {
    display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
    fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
    color: "#9ca3af", marginBottom: "5px",
  };
  const errMsg = (k) => errors[k] && (
    <div style={{ color: "#ef4444", fontSize: "13px",
      fontFamily: "'DM Sans', sans-serif", marginTop: "3px" }}>{errors[k]}</div>
  );
  const chipBtn = (active, onClick, label) => (
    <button onClick={onClick} style={{
      padding: "7px 14px", borderRadius: "20px", cursor: "pointer",
      border: `1.5px solid ${active ? "#C4541A" : "#d1d5db"}`,
      background: active ? "#C4541A" : "#fff",
      color: active ? "#fff" : "#6b7280",
      fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
      fontWeight: active ? 600 : 400, transition: "all 0.12s",
    }}>{label}</button>
  );

  // ZIP → city + state
  const lookupZip = async (zip) => {
    setZipLookup("loading");
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!res.ok) { setZipLookup("notfound"); f("city",""); f("state",""); return; }
      const data = await res.json();
      const place = data.places?.[0];
      if (place) {
        f("city", place["place name"]);
        f("state", place["state abbreviation"]);
        setZipLookup("found");
        clrErr("zip","city","state");
      } else { setZipLookup("notfound"); }
    } catch { setZipLookup("notfound"); }
  };

  const STEPS = ["Contact", "Experience", "Availability"];
  const accentBar = (
    <div style={{ height: "4px", background: "linear-gradient(90deg,#C4541A,#D4A843)",
      borderRadius: "4px 4px 0 0" }} />
  );
  const backBtn = (label = "← Back", onClick) => (
    <button onClick={onClick} style={{ padding: "13px 20px", borderRadius: "12px",
      border: "1.5px solid #e4e7ec", background: "#fff", color: "#6b7280",
      fontFamily: "'DM Sans', sans-serif", fontSize: "15px", cursor: "pointer" }}>
      {label}
    </button>
  );
  const nextBtn = (label, onClick, disabled=false) => (
    <button onClick={onClick} disabled={disabled} style={{ flex: 1, padding: "13px",
      borderRadius: "12px", border: "none",
      background: disabled ? "#e4e7ec" : "#C4541A",
      color: disabled ? "#9ca3af" : "#fff",
      fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
      fontWeight: 500, cursor: disabled ? "default" : "pointer",
      transition: "background 0.15s" }}>
      {label}
    </button>
  );

  const handleFinalSubmit = async () => {
    const errs = {};
    if (!form.ref1Name.trim())                            errs.ref1Name  = "Required";
    if (form.ref1Phone.replace(/\D/g,"").length < 10)    errs.ref1Phone = "Valid phone required";
    if (!form.ref2Name.trim())                            errs.ref2Name  = "Required";
    if (form.ref2Phone.replace(/\D/g,"").length < 10)    errs.ref2Phone = "Valid phone required";
    if (form.days.length === 0)                           errs.days      = "Select at least one day";
    if (form.times.length === 0)                          errs.times     = "Select at least one time window";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({}); setSubmit(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          first_name:        form.firstName.trim(),
          last_name:         form.lastName.trim(),
          email:             form.email.trim().toLowerCase(),
          phone:             form.phone,
          zip:               form.zip,
          city:              form.city,
          state:             form.state,
          address:           form.address.trim(),
          has_dog_exp:       form.hasDogExp === true,
          exp_years:         form.expYears || "0",
          exp_desc:          form.expDesc,
          first_aid:         form.firstAid,
          pet_cpr:           form.petCpr,
          message:           form.otherCerts,
          ref1_name:         form.ref1Name,
          ref1_phone:        form.ref1Phone,
          ref1_rel:          form.ref1Rel,
          ref2_name:         form.ref2Name,
          ref2_phone:        form.ref2Phone,
          ref2_rel:          form.ref2Rel,
          days:              form.days,
          times:             form.times,
          hours_per_week:    form.hoursPerWeek,
          status:            "pending",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDone(true);
    } catch {
      setErrors({ submit: "Something went wrong. Please try again." });
      return;
    } finally { setSubmit(false); }
    // Notify admins outside try/catch so it always fires
    notifyAdmin("new_applicant", {
      name: `${form.firstName.trim()} ${form.lastName.trim()}`,
      email: form.email.trim(),
      phone: form.phone,
      city: form.city,
      hasExp: form.hasDogExp === true,
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');`}</style>

      {/* Sticky header */}
      <div style={{ background: "#0B1423", padding: "16px 24px",
        display: "flex", alignItems: "center", gap: "16px", position: "sticky", top: 0, zIndex: 10 }}>
        <button onClick={onBack} style={{ background: "none", border: "none",
          color: "#ffffffaa", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
          fontSize: "15px", display: "flex", alignItems: "center", gap: "6px" }}>
          ← Back
        </button>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
          textTransform: "uppercase", letterSpacing: "1.5px",
          fontWeight: 600, color: "#fff", flex: 1, textAlign: "center" }}>
          Join the Team
        </div>
        <div style={{ width: "48px" }} />
      </div>

      <div style={{ maxWidth: "580px", margin: "0 auto", padding: "32px 20px" }}>
        {accentBar}

        {/* ── Done screen ── */}
        {done ? (
          <div style={{ background: "#fff", border: "1.5px solid #D4A87A", borderTop: "none",
            borderRadius: "0 0 20px 20px", padding: "48px 32px", textAlign: "center",
            boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🐾</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#C4541A", marginBottom: "12px" }}>
              Application Received!
            </div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              color: "#374151", lineHeight: "1.7", maxWidth: "380px", margin: "0 auto 28px" }}>
              Thanks, {form.firstName}! We'll review your application and reach out
              to {form.email} within 3–5 business days.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={onBack} style={{ padding: "11px 24px", borderRadius: "10px",
                border: "1.5px solid #e4e7ec", background: "#fff", color: "#374151",
                fontFamily: "'DM Sans', sans-serif", fontSize: "16px", cursor: "pointer" }}>
                ← Back to Site
              </button>
              <button onClick={() => { setForm(blank); setDone(false); setStep(1); setErrors({}); setZipLookup("idle"); }}
                style={{ padding: "11px 24px", borderRadius: "10px", border: "none",
                  background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "16px", fontWeight: 500, cursor: "pointer" }}>
                Submit Another
              </button>
            </div>
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1.5px solid #e4e7ec", borderTop: "none",
            borderRadius: "0 0 20px 20px", overflow: "hidden",
            boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>

            {/* Progress tabs */}
            <div style={{ display: "flex", borderBottom: "1.5px solid #f3f4f6" }}>
              {STEPS.map((label, i) => {
                const s = i + 1;
                const active = step === s; const done_s = step > s;
                return (
                  <div key={s} style={{ flex: 1, padding: "14px 0", textAlign: "center",
                    borderBottom: active ? "2.5px solid #C4541A" : "2.5px solid transparent",
                    background: active ? "#FDF5EC" : "transparent", cursor: done_s ? "pointer" : "default" }}
                    onClick={() => done_s && setStep(s)}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                      fontWeight: active ? 700 : 400, textTransform: "uppercase", letterSpacing: "1px",
                      color: active ? "#C4541A" : done_s ? "#9ca3af" : "#d1d5db" }}>
                      {done_s ? "✓ " : ""}{label}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: "28px 24px" }}>

              {/* ══════════════════════════════════════════════
                  STEP 1 — Contact Info
              ══════════════════════════════════════════════ */}
              {step === 1 && (
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                    fontWeight: 600, color: "#111827", marginBottom: "6px" }}>
                    Let's get acquainted.
                  </div>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                    color: "#9ca3af", marginBottom: "24px" }}>
                    Basic contact info to get started.
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                    <div>
                      <label style={lbl}>First Name *</label>
                      <input value={form.firstName}
                        onChange={e => { f("firstName", e.target.value); clrErr("firstName"); }}
                        placeholder="Jane" style={inp(errors.firstName)} />
                      {errMsg("firstName")}
                    </div>
                    <div>
                      <label style={lbl}>Last Name *</label>
                      <input value={form.lastName}
                        onChange={e => { f("lastName", e.target.value); clrErr("lastName"); }}
                        placeholder="Smith" style={inp(errors.lastName)} />
                      {errMsg("lastName")}
                    </div>
                  </div>

                  <div style={{ marginBottom: "14px" }}>
                    <label style={lbl}>Email Address *</label>
                    <input type="email" value={form.email}
                      onChange={e => { f("email", e.target.value); clrErr("email"); }}
                      placeholder="jane@email.com" style={inp(errors.email)} />
                    {errMsg("email")}
                  </div>

                  <div style={{ marginBottom: "14px" }}>
                    <label style={lbl}>Phone Number *</label>
                    <input type="tel" value={form.phone}
                      onChange={e => { f("phone", formatPhone(e.target.value)); clrErr("phone"); }}
                      placeholder="214.555.0000" maxLength={12} style={inp(errors.phone)} />
                    {errMsg("phone")}
                  </div>

                  <div style={{ marginBottom: "14px" }}>
                    <label style={lbl}>ZIP Code *</label>
                    <div style={{ position: "relative" }}>
                      <input value={form.zip}
                        onChange={e => {
                          const z = e.target.value.replace(/\D/g,"").slice(0,5);
                          f("zip", z); clrErr("zip");
                          if (z.length === 5) lookupZip(z);
                          else { f("city",""); f("state",""); setZipLookup("idle"); }
                        }}
                        placeholder="75238" maxLength={5} inputMode="numeric"
                        style={inp(errors.zip)} />
                      {zipLookup === "loading" && (
                        <div style={{ position: "absolute", right: "12px", top: "50%",
                          transform: "translateY(-50%)", fontFamily: "'DM Sans', sans-serif",
                          fontSize: "13px", color: "#9ca3af" }}>Looking up…</div>
                      )}
                    </div>
                    {errMsg("zip")}
                    {zipLookup === "notfound" && (
                      <div style={{ color: "#b45309", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "13px", marginTop: "3px" }}>
                        ZIP not found — check and try again.
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px", marginBottom: "14px" }}>
                    <div>
                      <label style={lbl}>City {zipLookup === "found" ? "✓" : "*"}</label>
                      <input value={form.city}
                        onChange={e => { f("city", e.target.value); clrErr("city"); }}
                        placeholder="Auto-filled from ZIP"
                        style={{ ...inp(errors.city),
                          background: zipLookup === "found" ? "#f9fafb" : "#fff",
                          color: zipLookup === "found" ? "#6b7280" : "#111827" }} />
                      {errMsg("city")}
                    </div>
                    <div>
                      <label style={lbl}>State {zipLookup === "found" ? "✓" : ""}</label>
                      <input value={form.state}
                        onChange={e => f("state", e.target.value.toUpperCase().slice(0,2))}
                        placeholder="TX" maxLength={2}
                        style={{ ...inp(false),
                          background: zipLookup === "found" ? "#f9fafb" : "#fff",
                          color: zipLookup === "found" ? "#6b7280" : "#111827" }} />
                    </div>
                  </div>

                  <div style={{ marginBottom: "28px" }}>
                    <label style={lbl}>Home Address *</label>
                    <input value={form.address}
                      onChange={e => { f("address", e.target.value); clrErr("address"); }}
                      placeholder="1234 Audelia Rd" style={inp(errors.address)} />
                    {errMsg("address")}
                  </div>

                  {nextBtn("Next: Experience →", () => {
                    const errs = {};
                    if (!form.firstName.trim())                       errs.firstName = "Required";
                    if (!form.lastName.trim())                        errs.lastName  = "Required";
                    if (!form.email.includes("@"))                    errs.email     = "Valid email required";
                    if (form.phone.replace(/\D/g,"").length < 10)    errs.phone     = "Valid phone required";
                    if (form.zip.length < 5)                          errs.zip       = "5-digit ZIP required";
                    if (!form.city.trim())                            errs.city      = "Enter a valid ZIP first";
                    if (!form.address.trim())                         errs.address   = "Required";
                    if (Object.keys(errs).length) { setErrors(errs); return; }
                    setErrors({}); setStep(2);
                  })}
                </div>
              )}

              {/* ══════════════════════════════════════════════
                  STEP 2 — Experience & Certifications
              ══════════════════════════════════════════════ */}
              {step === 2 && (
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                    fontWeight: 600, color: "#111827", marginBottom: "6px" }}>
                    Experience & certifications.
                  </div>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                    color: "#9ca3af", marginBottom: "24px" }}>
                    No experience? No problem. We just want to know where you're starting from.
                  </p>

                  {/* Dog walking experience */}
                  <div style={{ marginBottom: "20px" }}>
                    <label style={lbl}>Dog walking or pet care experience? *</label>
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                      {[{ v: true, l: "Yes" }, { v: false, l: "Nope, but I'm ready" }].map(({ v, l }) => (
                        <button key={l} onClick={() => { f("hasDogExp", v); clrErr("hasDogExp"); }}
                          style={{ padding: "10px 18px", borderRadius: "10px", border: "none",
                            cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                            fontWeight: form.hasDogExp === v ? 600 : 400,
                            background: form.hasDogExp === v ? "#C4541A" : "#f3f4f6",
                            color: form.hasDogExp === v ? "#fff" : "#6b7280",
                            transition: "all 0.12s" }}>
                          {l}
                        </button>
                      ))}
                    </div>
                    {errMsg("hasDogExp")}
                  </div>

                  {/* If yes — details */}
                  {form.hasDogExp === true && (
                    <div style={{ background: "#FDF5EC", border: "1.5px solid #D4A87A",
                      borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
                      <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", marginBottom: "12px" }}>
                        <div style={{ flex: "0 0 110px" }}>
                          <label style={lbl}>Years exp.</label>
                          <input type="number" min="0" max="40" value={form.expYears}
                            onChange={e => f("expYears", e.target.value)}
                            placeholder="0"
                            style={{ ...inp(false), background: "#fff" }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={lbl}>Where / what kind?</label>
                          <input value={form.expDesc}
                            onChange={e => f("expDesc", e.target.value)}
                            placeholder="Rover, Wag, private clients, shelter volunteer…"
                            style={{ ...inp(false), background: "#fff" }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Certifications */}
                  <div style={{ marginBottom: "20px" }}>
                    <label style={{ ...lbl, marginBottom: "10px" }}>Certifications (check all that apply)</label>
                    {[
                      { key: "firstAid", label: "Pet First Aid", desc: "Certified in pet first aid response" },
                      { key: "petCpr",   label: "Pet CPR",       desc: "Certified in pet CPR" },
                    ].map(({ key, label, desc }) => (
                      <div key={key} onClick={() => f(key, !form[key])}
                        style={{ display: "flex", alignItems: "center", gap: "12px",
                          cursor: "pointer", padding: "12px 14px", borderRadius: "10px", marginBottom: "8px",
                          border: `1.5px solid ${form[key] ? "#D4A843" : "#e4e7ec"}`,
                          background: form[key] ? "#FDF5EC" : "#fff", transition: "all 0.12s" }}>
                        <input type="checkbox" checked={form[key]} onChange={() => {}}
                          style={{ width: "16px", height: "16px", accentColor: "#C4541A", flexShrink: 0 }} />
                        <div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                            fontWeight: 600, color: form[key] ? "#C4541A" : "#374151" }}>{label}</div>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                            color: "#9ca3af" }}>{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Other certs / notes */}
                  <div style={{ marginBottom: "28px" }}>
                    <label style={lbl}>Any other relevant training or certifications?</label>
                    <input value={form.otherCerts}
                      onChange={e => f("otherCerts", e.target.value)}
                      placeholder="Vet tech training, shelter work, animal behavior course…"
                      style={inp(false)} />
                  </div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    {backBtn("← Back", () => { setErrors({}); setStep(1); })}
                    {nextBtn("Next: Availability →", () => {
                      const errs = {};
                      if (form.hasDogExp === null) errs.hasDogExp = "Please select one";
                      if (Object.keys(errs).length) { setErrors(errs); return; }
                      setErrors({}); setStep(3);
                    })}
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════════
                  STEP 3 — References & Availability
              ══════════════════════════════════════════════ */}
              {step === 3 && (
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                    fontWeight: 600, color: "#111827", marginBottom: "6px" }}>
                    References & availability.
                  </div>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                    color: "#9ca3af", marginBottom: "24px" }}>
                    Two references and your general schedule. Almost done.
                  </p>

                  {/* References */}
                  {[
                    { prefix: "ref1", label: "Reference 1" },
                    { prefix: "ref2", label: "Reference 2" },
                  ].map(({ prefix, label }) => (
                    <div key={prefix} style={{ background: "#f9fafb", borderRadius: "12px",
                      padding: "16px", marginBottom: "14px", border: "1.5px solid #e4e7ec" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                        fontWeight: 700, color: "#9ca3af", marginBottom: "12px",
                        textTransform: "uppercase", letterSpacing: "1px" }}>{label}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                        <div>
                          <label style={lbl}>Name *</label>
                          <input value={form[`${prefix}Name`]}
                            onChange={e => { f(`${prefix}Name`, e.target.value); clrErr(`${prefix}Name`); }}
                            placeholder="Full name"
                            style={{ ...inp(errors[`${prefix}Name`]), padding: "9px 11px" }} />
                          {errMsg(`${prefix}Name`)}
                        </div>
                        <div>
                          <label style={lbl}>Phone *</label>
                          <input value={form[`${prefix}Phone`]}
                            onChange={e => { f(`${prefix}Phone`, formatPhone(e.target.value)); clrErr(`${prefix}Phone`); }}
                            placeholder="214.555.0000" maxLength={12}
                            style={{ ...inp(errors[`${prefix}Phone`]), padding: "9px 11px" }} />
                          {errMsg(`${prefix}Phone`)}
                        </div>
                      </div>
                      <div>
                        <label style={lbl}>Relationship</label>
                        <input value={form[`${prefix}Rel`]}
                          onChange={e => f(`${prefix}Rel`, e.target.value)}
                          placeholder="Former employer, colleague, client…"
                          style={{ ...inp(false), padding: "9px 11px" }} />
                      </div>
                    </div>
                  ))}

                  {/* Days */}
                  <div style={{ marginBottom: "18px" }}>
                    <label style={{ ...lbl, marginBottom: "8px" }}>Days generally available *</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                      {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(d =>
                        chipBtn(form.days.includes(d), () => { toggleArr("days", d); clrErr("days"); }, d.slice(0,3))
                      )}
                      {chipBtn(form.days.length === 7,
                        () => { setForm(p=>({...p, days: p.days.length===7?[]:[...["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]]})); clrErr("days"); },
                        "All"
                      )}
                    </div>
                    {errMsg("days")}
                  </div>

                  {/* Time windows */}
                  <div style={{ marginBottom: "18px" }}>
                    <label style={{ ...lbl, marginBottom: "8px" }}>Time windows that work *</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                      {["Morning (7–11 AM)", "Midday (11 AM–2 PM)", "Afternoon (2–6 PM)", "Evening (6–9 PM)"].map(t =>
                        chipBtn(form.times.includes(t), () => { toggleArr("times", t); clrErr("times"); }, t)
                      )}
                    </div>
                    {errMsg("times")}
                  </div>

                  {/* Hours per week */}
                  <div style={{ marginBottom: "28px" }}>
                    <label style={{ ...lbl, marginBottom: "8px" }}>Hours per week you're looking for</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                      {["Under 10 hrs","10–20 hrs","20–30 hrs","30+ hrs"].map(h =>
                        chipBtn(form.hoursPerWeek === h,
                          () => f("hoursPerWeek", form.hoursPerWeek === h ? "" : h), h)
                      )}
                    </div>
                  </div>

                  {errors.submit && (
                    <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5",
                      borderRadius: "10px", padding: "12px 16px", marginBottom: "16px",
                      fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#dc2626" }}>
                      {errors.submit}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "10px" }}>
                    {backBtn("← Back", () => { setErrors({}); setStep(2); })}
                    {nextBtn(submitting ? "Submitting…" : "Submit Application →", handleFinalSubmit, submitting)}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  );
}



export default WalkerApplicationPage;
