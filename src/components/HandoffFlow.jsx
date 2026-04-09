import { useState, useEffect, useRef } from "react";
import { ALL_HANDOFF_SLOTS, DAYS, FULL_DAYS, WALKER_SERVICES } from "../constants.js";
import { saveClients, notifyAdmin } from "../supabase.js";
import { addrFromString, addrToString, dateStrFromDate, firstName, fmt, formatPhone, generateCode, getSessionPrice, getWeekDates } from "../helpers.js";
import { GLOBAL_STYLES } from "../styles.js";
import { getAllWalkers } from "./auth/WalkerAuthScreen.jsx";
import AddressFields from "./shared/AddressFields.jsx";;

// ─── Meet & Greet Flow ─────────────────────────────────────────────────────────────
// ─── Meet & Greet Flow ─────────────────────────────────────────────────────────────
// Find the first available Mon–Fri day + first non-past meet & greet slot
function getInitialHandoff() {
  const now = new Date();
  for (let w = 0; w <= 8; w++) {
    const wDates = getWeekDates(w);
    for (let d = 0; d < 5; d++) { // Mon–Fri only
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (wDates[d] >= midnight) return [w, d, null];
    }
  }
  return [0, 0, null];
}

function HandoffFlow({ client, onComplete, walkerProfiles = {} }) {
  // stage: "intro" | "team" | "pick" | "verify" | "done"
  const [stage, setStage] = useState("intro");
  const [selDay, setSelDay] = useState(() => getInitialHandoff()[1]);
  const [selSlot, setSelSlot] = useState(() => getInitialHandoff()[2]);
  const [selWalker, setSelWalker] = useState("");
  const [handoffPhone, setHandoffPhone] = useState(client.phone || "");
  const [handoffAddress, setHandoffAddress] = useState(client.address || "");
  const [handoffAddrObj, setHandoffAddrObj] = useState(
    client.addrObj && client.addrObj.street ? client.addrObj : addrFromString(client.address || "")
  );
  const [handoffErrors, setHandoffErrors] = useState({});
  const [verifyCode] = useState(generateCode());
  const [enteredCode, setEnteredCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [expandedWalker, setExpandedWalker] = useState(null);
  const [handoffWeekOffset, setHandoffWeekOffset] = useState(() => getInitialHandoff()[0]);
  const [addFollowOnWalk, setAddFollowOnWalk] = useState(false);
  const [followOnDuration, setFollowOnDuration] = useState("30 min");
  const weekDates = getWeekDates(handoffWeekOffset);

  // Scroll refs for progressive sections
  const slotSectionRef   = useRef(null);
  const detailsSectionRef = useRef(null);
  const pickSectionRef   = useRef(null);

  // Auto-scroll when stage enters "pick"
  useEffect(() => {
    if (stage === "pick") {
      setTimeout(() => pickSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }, [stage]);

  // Auto-scroll to time slots when a day is selected
  useEffect(() => {
    if (selDay !== null) {
      setTimeout(() => slotSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
    }
  }, [selDay]);

  // Auto-scroll to walker/details when a slot is selected
  useEffect(() => {
    if (selSlot) {
      setTimeout(() => detailsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }, [selSlot]);

  // Helper: compute follow-on walk start time (meet & greet slot + 30 min)
  const getFollowOnTime = () => {
    if (!selSlot) return null;
    const totalMins = selSlot.hour * 60 + selSlot.minute + 15;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const ampm = h < 12 ? "AM" : "PM";
    const mStr = m === 0 ? "00" : m === 15 ? "15" : m === 30 ? "30" : "45";
    return { time: `${hour12}:${mStr} ${ampm}`, hour: h, minute: m };
  };

  const sendCode = () => setCodeSent(true);

  const handleVerify = () => {
    if (enteredCode.trim() === verifyCode) {
      setStage("done");
    } else {
      setCodeError("Incorrect code. Please try again.");
    }
  };

  const accentColor = "#C4541A";

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <style>{GLOBAL_STYLES}</style>

      <div className="app-container">

        {/* Intro */}
        {stage === "intro" && (
          <div className="fade-up">
            <div style={{ background: "#0B1423", borderRadius: "20px", padding: "32px 28px",
              textAlign: "center", marginBottom: "24px" }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>🤝</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, marginBottom: "10px" }}>
                Welcome, {client.name}!
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffcc",
                fontSize: "16px", lineHeight: "1.7", marginBottom: "10px" }}>
                Before your first regular booking, we require a quick <strong style={{ color: "#fff" }}>Meet & Greet Appointment</strong> — 
                a chance to meet your walker, hand over a spare key, and make sure your pet feels comfortable.
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
                fontSize: "15px", fontStyle: "italic" }}>
              {(() => {
                const allPets = [...(client.dogs || client.pets || []), ...(client.cats || [])];
                return allPets.length > 0
                  ? `We look forward to meeting ${allPets.length === 1
                      ? allPets[0]
                      : allPets.slice(0, -1).join(", ") + " and " + allPets[allPets.length - 1]
                    } soon! 🐾`
                  : "We look forward to meeting your furry friend soon! 🐾";
              })()}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "28px",
              padding: "4px 4px" }}>
              {[
                { icon: "👋", title: "Meet your walker", desc: "30-minute in-person introduction at your home." },
                { icon: "🔑", title: "Hand over a key", desc: "So your walker can access your home for future visits." },
                { icon: "📋", title: "Share your pet's routine", desc: "Walk preferences, feeding schedule, any quirks." },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                  <div style={{ fontSize: "20px", flexShrink: 0, marginTop: "1px", opacity: 0.85 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                      fontSize: "16px", color: "#111827", marginBottom: "2px" }}>{item.title}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
                      lineHeight: "1.5" }}>
                      {item.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setStage("team")} style={{
              width: "100%", padding: "16px", borderRadius: "14px",
              background: "#fff", color: "#0B1423", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
              border: "1.5px solid #d1d5db", marginBottom: "10px",
            }}>
              Meet the Team First →
            </button>
            <button onClick={() => setStage("pick")} style={{
              width: "100%", padding: "16px", borderRadius: "14px", border: "none",
              background: "#0B1423", color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
            }}>
              Schedule My Meet & Greet →
            </button>
          </div>
        )}

        {/* Meet the Team */}
        {stage === "team" && (
          <div className="fade-up">
            <button onClick={() => setStage("intro")} style={{ background: "none", border: "none",
              color: "#6b7280", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "6px" }}>
              ← Back
            </button>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "6px" }}>Meet the Team</div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280",
              marginBottom: "24px", lineHeight: "1.6" }}>
              Get to know your walkers before booking. You can choose a preferred walker when you schedule your meet & greet.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "28px" }}>
              {getAllWalkers(walkerProfiles).map(walker => {
                const open = expandedWalker === walker.id;
                return (
                  <div key={walker.id} style={{ background: "#fff",
                    border: open ? `2px solid ${walker.color}` : "1.5px solid #e4e7ec",
                    borderRadius: "16px", overflow: "hidden", transition: "all 0.2s ease",
                    boxShadow: open ? `0 4px 20px ${walker.color}22` : "0 2px 8px rgba(0,0,0,0.04)" }}>
                    <button onClick={() => setExpandedWalker(open ? null : walker.id)} style={{
                      width: "100%", background: "none", border: "none", padding: "18px 20px",
                      cursor: "pointer", display: "flex", alignItems: "center", gap: "14px", textAlign: "left" }}>
                      <div style={{ width: "48px", height: "48px", borderRadius: "50%",
                        background: walker.color + "18", border: `2px solid ${walker.color}44`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "22px", flexShrink: 0 }}>{walker.avatar}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                          fontWeight: 600, color: "#111827", marginBottom: "2px" }}>{firstName(walker.name)}</div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: walker.color, fontWeight: 500 }}>{(walker.role || "").replace(/ & /g, " / ")}</div>
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#9ca3af", textAlign: "right" }}>
                        <div>{walker.years >= 10 ? "10+" : walker.years} yrs exp.</div>
                        <div style={{ fontSize: "18px", transform: open ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "transform 0.2s" }}>⌄</div>
                      </div>
                    </button>
                    {open && (
                      <div style={{ padding: "0 20px 20px", borderTop: "1px solid #f3f4f6" }}>
                        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                          color: "#374151", lineHeight: "1.65", margin: "16px 0 12px" }}>{walker.bio}</p>
                        {(() => {
                          const svcs = walkerProfiles[walker.id]?.services || [];
                          if (!svcs.length) return null;
                          return (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                              {WALKER_SERVICES.filter(s => svcs.includes(s.id)).map(s => (
                                <span key={s.id} style={{
                                  display: "inline-flex", alignItems: "center", gap: "5px",
                                  padding: "4px 10px", borderRadius: "20px", fontSize: "16px",
                                  fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                                  color: s.color, background: s.bg, border: `1px solid ${s.border}`,
                                }}>
                                  {s.icon} {s.label}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={() => setStage("pick")} style={{
              width: "100%", padding: "16px", borderRadius: "14px", border: "none",
              background: "#0B1423", color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
            }}>
              Schedule My Meet & Greet →
            </button>
          </div>
        )}

        {/* Pick day + slot */}
        {stage === "pick" && (
          <div ref={pickSectionRef} className="fade-up">
            <button onClick={() => setStage("intro")} style={{ background: "none", border: "none",
              color: "#6b7280", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "6px" }}>
              ← Back
            </button>

            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "20px" }}>
              Choose a day & time
            </div>

            {/* Day selector — Mon–Fri only, no past days */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: "10px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                  letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af" }}>
                  Select Date
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button onClick={() => { if (handoffWeekOffset > 0) { setHandoffWeekOffset(w => w - 1); setSelDay(null); setSelSlot(null); } }}
                    disabled={handoffWeekOffset === 0}
                    style={{ width: "28px", height: "28px", borderRadius: "8px",
                      border: "1.5px solid #e4e7ec", background: handoffWeekOffset === 0 ? "#f9fafb" : "#fff",
                      color: handoffWeekOffset === 0 ? "#d1d5db" : "#374151",
                      cursor: handoffWeekOffset === 0 ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>‹</button>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                    color: "#6b7280", minWidth: "72px", textAlign: "center" }}>
                    {handoffWeekOffset === 0 ? "This week" : handoffWeekOffset === 1 ? "Next week" : `+${handoffWeekOffset} weeks`}
                  </div>
                  <button onClick={() => { setHandoffWeekOffset(w => w + 1); setSelDay(null); setSelSlot(null); }}
                    disabled={handoffWeekOffset >= 8}
                    style={{ width: "28px", height: "28px", borderRadius: "8px",
                      border: "1.5px solid #e4e7ec", background: handoffWeekOffset >= 8 ? "#f9fafb" : "#fff",
                      color: handoffWeekOffset >= 8 ? "#d1d5db" : "#374151",
                      cursor: handoffWeekOffset >= 8 ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>›</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}>
                {/* Mon–Fri only: indices 0–4 */}
                {[0,1,2,3,4].map(i => {
                  const date = weekDates[i];
                  const now = new Date();
                  const isPast = date < new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const active = selDay === i;
                  const disabled = isPast;
                  return (
                    <button key={i} onClick={() => { if (!disabled) { setSelDay(i); setSelSlot(null); } }}
                      disabled={disabled}
                      style={{
                        minWidth: "58px", padding: "10px 6px", borderRadius: "10px",
                        border: active ? `2px solid ${accentColor}` : "2px solid #e4e7ec",
                        background: active ? accentColor : disabled ? "#f9fafb" : "#fff",
                        color: active ? "#fff" : disabled ? "#d1d5db" : "#374151",
                        cursor: disabled ? "default" : "pointer",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
                        fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
                      }}>
                      <span style={{ fontSize: "16px", fontWeight: 600, textTransform: "uppercase" }}>{DAYS[i]}</span>
                      <span style={{ fontSize: "17px", fontWeight: 700 }}>{date.getDate()}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time window selector */}
            {selDay !== null && (
              <div ref={slotSectionRef} style={{ marginBottom: "24px" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600,
                  letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "6px" }}>
                  {FULL_DAYS[selDay]}, {dateStrFromDate(weekDates[selDay])} — Appointment Window
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                  color: "#9ca3af", marginBottom: "14px", lineHeight: "1.5" }}>
                  Your personal walker will reach out to confirm their arrival time.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  {ALL_HANDOFF_SLOTS.map(slot => {
                    const active = selSlot?.id === slot.id;
                    return (
                      <button key={slot.id} onClick={() => setSelSlot(slot)}
                        style={{
                          padding: "16px 12px", borderRadius: "12px", cursor: "pointer",
                          border: active ? `2px solid ${accentColor}` : "1.5px solid #e4e7ec",
                          background: active ? "#FDF5EC" : "#fff",
                          color: active ? accentColor : "#374151",
                          textAlign: "center", fontFamily: "'DM Sans', sans-serif",
                          boxShadow: active ? `0 2px 12px ${accentColor}22` : "0 2px 6px rgba(0,0,0,0.04)",
                          transition: "all 0.15s",
                        }}>
                        <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "4px" }}>{slot.label}</div>
                        <div style={{ fontSize: "13px", color: active ? accentColor : "#9ca3af" }}>15-min meet & greet</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Phone + Address — required before confirming */}
            {selSlot && (
              <div className="fade-up" style={{ marginBottom: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "16px", fontWeight: 500, marginBottom: "6px",
                    color: handoffErrors.phone ? "#dc2626" : "#374151" }}>
                    Phone Number <span style={{ color: "#dc2626" }}>*</span>
                    {handoffErrors.phone && <span style={{ fontWeight: 400, fontSize: "15px",
                      marginLeft: "6px", color: "#dc2626" }}>— {handoffErrors.phone}</span>}
                  </label>
                  <input type="tel" placeholder="214.555.0000" value={handoffPhone}
                    onChange={e => { setHandoffPhone(formatPhone(e.target.value)); setHandoffErrors(p => ({ ...p, phone: "" })); }}
                    maxLength={12}
                    style={{ width: "100%", padding: "12px 14px", borderRadius: "10px",
                      border: `1.5px solid ${handoffErrors.phone ? "#dc2626" : "#d1d5db"}`,
                      background: "#fff", fontSize: "15px", fontFamily: "'DM Sans', sans-serif",
                      color: "#111827", outline: "none" }}
                    onFocus={e => e.target.style.borderColor = accentColor}
                    onBlur={e => e.target.style.borderColor = handoffErrors.phone ? "#dc2626" : "#d1d5db"} />
                </div>
                <div>
                  <label style={{ display: "block", fontFamily: "'DM Sans', sans-serif",
                    fontSize: "16px", fontWeight: 500, marginBottom: "8px",
                    color: handoffErrors.address ? "#dc2626" : "#374151" }}>
                    Home Address <span style={{ color: "#dc2626" }}>*</span>
                    {handoffErrors.address && <span style={{ fontWeight: 400, fontSize: "15px",
                      marginLeft: "6px", color: "#dc2626" }}>— {handoffErrors.address}</span>}
                  </label>
                  <AddressFields
                    value={handoffAddrObj}
                    onChange={(obj, str) => {
                      setHandoffAddrObj(obj);
                      setHandoffAddress(str);
                      setHandoffErrors(p => ({ ...p, address: "", zip: "" }));
                    }}
                    errors={{
                      ...(handoffErrors.address ? { street: handoffErrors.address } : {}),
                      ...(handoffErrors.zip ? { zip: handoffErrors.zip } : {}),
                    }}
                  />
                </div>
              </div>
            )}

            {/* Follow-on walk toggle */}
            {selSlot && (() => {
              const followOn = getFollowOnTime();
              return (
                <div className="fade-up" style={{ marginBottom: "20px" }}>
                  <div onClick={() => setAddFollowOnWalk(v => !v)} style={{
                    padding: "14px 16px", borderRadius: "12px", cursor: "pointer",
                    border: addFollowOnWalk ? "2px solid #8B5E3C" : "1.5px solid #d1d5db",
                    background: addFollowOnWalk ? "#FDF5EC" : "#fff",
                    display: "flex", alignItems: "center", gap: "14px",
                    transition: "all 0.15s", marginBottom: addFollowOnWalk ? "12px" : "0",
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                        fontSize: "16px", color: "#111827", marginBottom: "2px" }}>
                        🐕 Add a walk after the meet & greet
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                        Schedule a 30 or 60 min walk immediately following your 15-min meet & greet
                        {followOn ? ` (starts at ${followOn.time})` : ""}.
                      </div>
                    </div>
                    <div style={{
                      width: "44px", height: "24px", borderRadius: "12px", flexShrink: 0,
                      background: addFollowOnWalk ? "#C4541A" : "#d1d5db",
                      position: "relative", transition: "background 0.2s",
                    }}>
                      <div style={{
                        position: "absolute", top: "3px",
                        left: addFollowOnWalk ? "23px" : "3px",
                        width: "18px", height: "18px", borderRadius: "50%",
                        background: "#fff", transition: "left 0.2s",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                      }} />
                    </div>
                  </div>

                  {addFollowOnWalk && followOn && (
                    <div className="fade-up" style={{ background: "#FDF5EC",
                      border: "1.5px solid #D4A87A", borderRadius: "12px", padding: "14px 16px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif",
                        fontWeight: 600, color: "#C4541A", marginBottom: "10px",
                        letterSpacing: "0.5px", textTransform: "uppercase", fontSize: "15px" }}>
                        Walk Duration
                      </div>
                      <div style={{ display: "flex", gap: "10px" }}>
                        {["30 min", "60 min"].map(d => (
                          <button key={d} onClick={() => setFollowOnDuration(d)} style={{
                            flex: 1, padding: "12px", borderRadius: "10px", cursor: "pointer",
                            border: followOnDuration === d ? "2px solid #8B5E3C" : "1.5px solid #D4A87A",
                            background: followOnDuration === d ? "#C4541A" : "#fff",
                            color: followOnDuration === d ? "#fff" : "#374151",
                            fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                            fontWeight: followOnDuration === d ? 600 : 400,
                            transition: "all 0.15s",
                          }}>
                            {d}
                          </button>
                        ))}
                      </div>
                      <div style={{ marginTop: "10px", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "16px", color: "#6b7280", lineHeight: "1.5" }}>
                        🤝 Meet & Greet: {selSlot?.label} window
                        <span style={{ marginLeft: "8px", color: "#D4A843" }}>·</span>
                        <span style={{ marginLeft: "8px" }}>
                          🐕 Walk: {followOn.time} ({followOnDuration})
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {selSlot && (
              <button
                onClick={() => {
                const errs = {};
                if (!handoffPhone.trim()) errs.phone = "Required";
                if (!handoffAddress.trim()) errs.address = "Required";
                if (!handoffAddrObj?.zip || handoffAddrObj.zip.replace(/\D/g, "").length !== 5) errs.zip = "A valid 5-digit ZIP code is required";
                if (Object.keys(errs).length) { setHandoffErrors(errs); return; }
                sendCode(); setStage("done");
              }} style={{
                width: "100%", padding: "16px", borderRadius: "14px", border: "none",
                background: "#0B1423", color: "#fff",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 500, cursor: "pointer",
              }}>
                Confirm Appointment →
              </button>
            )}
          </div>
        )}

        {/* Done */}
        {stage === "done" && (
          <div className="fade-up" style={{ textAlign: "center", paddingTop: "20px" }}>
            <div className="pop" style={{ fontSize: "56px", marginBottom: "16px" }}>✅</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
              fontWeight: 600, color: "#111827", marginBottom: "10px" }}>
              You're all set!
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              color: "#6b7280", lineHeight: "1.7", marginBottom: "24px" }}>
              Your meet & greet appointment is confirmed for{" "}
              <strong style={{ color: "#374151" }}>{FULL_DAYS[selDay]}, {dateStrFromDate(weekDates[selDay])}</strong>{" "}
              during the <strong style={{ color: "#374151" }}>{selSlot?.time}</strong> window.
              Your walker will reach out before the appointment to confirm their arrival time. We'll see you then!
            </div>

            {/* Show both appointments if follow-on walk was added */}
            {addFollowOnWalk && getFollowOnTime() && (
              <div className="fade-up" style={{ background: "#FDF5EC", border: "1.5px solid #D4A87A",
                borderRadius: "16px", padding: "16px 20px", marginBottom: "24px", textAlign: "left" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                  fontSize: "16px", color: "#C4541A", letterSpacing: "1px",
                  textTransform: "uppercase", marginBottom: "12px" }}>Your bookings</div>
                {[
                  { icon: "🤝", label: "Meet & Greet", time: selSlot?.label + " window", dur: "15 min", price: null },
                  { icon: "🐕", label: "First Walk", time: getFollowOnTime().time, dur: followOnDuration, price: fmt(getSessionPrice(followOnDuration, 1), true) },
                ].map((row, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px",
                    paddingTop: i > 0 ? "10px" : "0",
                    borderTop: i > 0 ? "1px solid #FDEBD4" : "none" }}>
                    <span style={{ fontSize: "22px" }}>{row.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                        fontSize: "15px", color: "#111827" }}>{row.label} — {row.dur}</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", color: "#6b7280" }}>
                        {FULL_DAYS[selDay]}, {dateStrFromDate(weekDates[selDay])} at {row.time}
                      </div>
                    </div>
                    {row.price && (
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                        fontWeight: 600, color: "#C4541A" }}>{row.price}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => onComplete({
              handoffDay: selDay, handoffSlot: selSlot, handoffWalker: selWalker,
              handoffDate: weekDates[selDay].toISOString(),
              handoffPhone, handoffAddress, handoffAddrObj,
              followOnWalk: addFollowOnWalk && getFollowOnTime() ? {
                duration: followOnDuration,
                slotTime: getFollowOnTime().time,
                hour: getFollowOnTime().hour,
                minute: getFollowOnTime().minute,
                dayOfWeek: selDay,
                date: weekDates[selDay].toISOString(),
              } : null,
            })} style={{
              padding: "15px 36px", borderRadius: "14px", border: "none",
              background: "#0B1423", color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", fontWeight: 500, cursor: "pointer",
            }}>
              Start Booking Services →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


export default HandoffFlow;
