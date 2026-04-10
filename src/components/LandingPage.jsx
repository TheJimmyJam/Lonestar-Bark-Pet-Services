import { useState, useEffect, useRef } from "react";
import { PRICING_TIERS, ADD_ONS, SERVICES } from "../constants.js";
import { firstName } from "../helpers.js";
import LogoBadge from "./shared/LogoBadge.jsx";

// ─── Landing Page ─────────────────────────────────────────────────────────────
function LandingPage({ onSignUp, onLogin, walkerProfiles = {} }) {
  const [expandedWalker, setExpandedWalker] = useState(null);
  const [navScrolled, setNavScrolled] = useState(false);
  const [landingMenuOpen, setLandingMenuOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(null); // index of open FAQ item
  const [landingView, setLandingView] = useState(
    () => window.location.hash === "#apply" ? "apply" : "home"
  ); // "home" | "apply"

  // Sync view with URL hash (handles direct links and back/forward)
  useEffect(() => {
    const handleHash = () => setLandingView(window.location.hash === "#apply" ? "apply" : "home");
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  // Keep hash in sync when view changes programmatically
  useEffect(() => {
    if (landingView === "apply" && window.location.hash !== "#apply") {
      window.history.replaceState(null, "", "#apply");
    } else if (landingView === "home" && window.location.hash === "#apply") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [landingView]);

  useEffect(() => {
    const handleScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const navHeight = document.querySelector("nav")?.offsetHeight || 64;
    const top = el.getBoundingClientRect().top + window.scrollY - navHeight - 12;
    window.scrollTo({ top, behavior: "smooth" });
  };

  const NAV_LINKS = [
    { id: "services", label: "Services" },
    { id: "pricing", label: "Pricing" },
    { id: "handoff", label: "How It Works" },
    // { id: "team", label: "Our Team" },
  ];

  const FAQ_ITEMS = [
    {
      q: "How do I pay?",
      a: "We accept payments via Stripe or cash. We will send you an invoice after each walk is completed.",
    },
    {
      q: "How much notice is needed for cancellation?",
      a: "We understand emergencies happen. We keep the following cancellation policy.\n\n24 hours: No charge\n12–24 hours: 50% booking fee\nLess than 12 hours: 100% booking fee",
    },
    {
      q: "What areas do you serve?",
      a: "We currently serve East Dallas and surrounding neighborhoods. Not sure if we cover your area? Sign up and we'll let you know.",
    },
    {
      q: "Do you have any references?",
      a: "Yes. Upon request we will provide a list of satisfied clients including phone numbers and emails.",
    },
    {
      q: "How are gratuities handled?",
      a: "Being a repeat customer, referring a friend, or writing a review will be the best gratuity you can provide. If you want to give a little something extra, you can send it with your invoice or give it to your walker directly. Gratuities go to your walker 100%.",
    },
    {
      q: "Are you bonded & insured?",
      a: "Yes. We are bonded and insured and will provide documentation during the initial consultation visit.",
    },
    {
      q: "What time will you visit my dog?",
      a: "During the initial consultation visit, we will determine what time works best for your schedule. You can view all of our walker's availability each week on our website.",
    },
    {
      q: "Still have questions?",
      a: "Complete our \"Contact Us\" form and we will contact you with answers.",
    },
  ];

  const LANDING_STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fadeIn { from{opacity:0} to{opacity:1} }
    @keyframes floatPaw { 0%,100%{transform:translateY(0) rotate(-8deg)} 50%{transform:translateY(-10px) rotate(-8deg)} }
    .lp-fade-1 { animation: fadeUp 0.7s ease 0.1s both; }
    .lp-fade-2 { animation: fadeUp 0.7s ease 0.25s both; }
    .lp-fade-3 { animation: fadeUp 0.7s ease 0.4s both; }
    .lp-fade-4 { animation: fadeUp 0.7s ease 0.55s both; }
    .lp-hover { transition: all 0.2s ease; }
    .lp-hover:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0,0,0,0.12) !important; }
    .lp-nav-link { transition: color 0.15s; cursor: pointer; }
    .lp-nav-link:hover { color: #BF8A50 !important; }
    .lp-cta-btn { transition: all 0.2s ease; }
    .lp-cta-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(26,107,74,0.35) !important; filter: brightness(1.06); }
    .lp-walker-card { transition: all 0.2s ease; }
    .lp-walker-card:hover { border-color: #D4A87A !important; box-shadow: 0 6px 24px rgba(26,107,74,0.10) !important; }
    .paw-float { animation: floatPaw 3.5s ease-in-out infinite; display: inline-block; }
    .section-divider { width: 48px; height: 3px; background: #8B5E3C; border-radius: 2px; margin: 0 auto 14px; }
    .lp-hamburger { display: flex; flex-direction: column; gap: 4px; align-items: center; background: transparent; border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 8px 10px; cursor: pointer; }
    @media (max-width: 767px) { .lp-nav { border-top: 9px solid #0B1423 !important; border-bottom: 9px solid #0B1423 !important; } }
    .lp-section { padding: 64px 20px; }
    @media (min-width: 768px) { .lp-section { padding: 96px 24px; } }
  `;

  return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{LANDING_STYLES}</style>

      {landingView === "apply" && (
        <WalkerApplicationPage onBack={() => setLandingView("home")} />
      )}

      {landingView === "home" && (<>

      {/* ── Sticky Nav ── */}
      <nav className="lp-nav" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        background: navScrolled ? "rgba(15,31,20,0.97)" : "transparent",
        backdropFilter: navScrolled ? "blur(12px)" : "none",
        borderBottom: navScrolled ? "1px solid rgba(255,255,255,0.06)" : "none",
        transition: "all 0.3s ease",
        padding: "0 24px",
      }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", height: "64px",
          display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>

            <LogoBadge size={32} />
            <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
              fontSize: "15px", textTransform: "uppercase", fontWeight: 600, letterSpacing: "1.5px" }}>
              Lonestar Bark Co.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <button className="lp-hamburger" onClick={() => setLandingMenuOpen(true)}>
              <span style={{ display: "block", width: "18px", height: "2px", background: "rgba(255,255,255,0.8)", borderRadius: "2px" }} />
              <span style={{ display: "block", width: "18px", height: "2px", background: "rgba(255,255,255,0.8)", borderRadius: "2px" }} />
              <span style={{ display: "block", width: "18px", height: "2px", background: "rgba(255,255,255,0.8)", borderRadius: "2px" }} />
            </button>
            <button onClick={onLogin} className="lp-cta-btn" style={{
              padding: "9px 20px", borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.18)", background: "transparent",
              color: "rgba(255,255,255,0.8)", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", fontWeight: 400, cursor: "pointer", letterSpacing: "0.3px",
            }}>Log In</button>
            <button onClick={onSignUp} className="lp-cta-btn" style={{
              padding: "9px 22px", borderRadius: "8px", border: "none",
              background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px", fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
            }}>Sign Up</button>
          </div>
        </div>
      </nav>

      {/* ── Mobile Menu Drawer ── */}
      {landingMenuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
          <div onClick={() => setLandingMenuOpen(false)}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)" }} />
          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "280px",
            background: "#0B1423", display: "flex", flexDirection: "column",
            boxShadow: "4px 0 28px rgba(0,0,0,0.4)" }}>
            <div style={{ padding: "24px 20px 16px", borderBottom: "1px solid #1E4A32",
              display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <LogoBadge size={28} />
                <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#fff",
                  fontSize: "15px", textTransform: "uppercase", fontWeight: 600, letterSpacing: "1px" }}>Lonestar Bark Co.</div>
              </div>
              <button onClick={() => setLandingMenuOpen(false)} style={{ background: "none",
                border: "none", color: "#9B7444", fontSize: "22px", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, padding: "16px 0", overflowY: "auto" }}>
              {NAV_LINKS.map(link => (
                <button key={link.id} onClick={() => { scrollTo(link.id); setLandingMenuOpen(false); }} style={{
                  width: "100%", padding: "14px 24px", border: "none", background: "transparent",
                  display: "flex", alignItems: "center", gap: "14px", cursor: "pointer",
                  textAlign: "left",
                }}>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                    fontWeight: 500, color: "rgba(255,255,255,0.85)", letterSpacing: "0.3px" }}>
                    {link.label}
                  </span>
                </button>
              ))}
              <button onClick={() => { setLandingView("apply"); setLandingMenuOpen(false); }} style={{
                width: "100%", padding: "14px 24px", border: "none", background: "transparent",
                display: "flex", alignItems: "center", gap: "14px", cursor: "pointer", textAlign: "left",
              }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 500, color: "#D4A843", letterSpacing: "0.3px" }}>
                  Join the Team ✦
                </span>
              </button>

              {/* FAQ section */}
              <div style={{ borderTop: "1px solid #1E4A32", marginTop: "8px", paddingTop: "8px" }}>
                <div style={{ padding: "10px 24px 6px", fontFamily: "'DM Sans', sans-serif",
                  fontSize: "11px", fontWeight: 700, letterSpacing: "2.5px",
                  textTransform: "uppercase", color: "#9B7444" }}>FAQ</div>
                {FAQ_ITEMS.map((item, i) => (
                  <div key={i}>
                    <button onClick={() => setFaqOpen(faqOpen === i ? null : i)} style={{
                      width: "100%", padding: "11px 24px", border: "none", background: "transparent",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      cursor: "pointer", textAlign: "left", gap: "12px",
                    }}>
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                        fontWeight: 500, color: "rgba(255,255,255,0.82)", lineHeight: "1.4", flex: 1 }}>
                        {item.q}
                      </span>
                      <span style={{ color: "#9B7444", fontSize: "16px", flexShrink: 0,
                        transition: "transform 0.2s",
                        transform: faqOpen === i ? "rotate(45deg)" : "rotate(0deg)" }}>+</span>
                    </button>
                    {faqOpen === i && (
                      <div style={{ padding: "0 24px 12px", fontFamily: "'DM Sans', sans-serif",
                        fontSize: "13px", color: "rgba(255,255,255,0.55)", lineHeight: "1.65" }}>
                        {item.a.split("\n").map((line, i) => (
                          <span key={i}>{line}{i < item.a.split("\n").length - 1 && <br />}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: "20px", borderTop: "1px solid #1E4A32",
              display: "flex", flexDirection: "column", gap: "10px" }}>
              <button onClick={() => { onSignUp(); setLandingMenuOpen(false); }} style={{
                width: "100%", padding: "13px", borderRadius: "10px", border: "none",
                background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "16px", fontWeight: 600, cursor: "pointer", letterSpacing: "0.3px",
              }}>Sign Up</button>
              <button onClick={() => { onLogin(); setLandingMenuOpen(false); }} style={{
                width: "100%", padding: "13px", borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
                color: "rgba(255,255,255,0.75)", fontFamily: "'DM Sans', sans-serif",
                fontSize: "16px", fontWeight: 400, cursor: "pointer",
              }}>Log In</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hero ── */}
      <section style={{
        background: "linear-gradient(160deg, #1E4A32 0%, #0B1423 55%, #112B20 100%)",
        minHeight: "100svh", display: "flex", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "clamp(80px, 12vw, 120px) clamp(16px, 5vw, 40px) 80px", position: "relative", overflow: "hidden",
      }}>
        {/* Subtle background texture dots */}
        <div style={{ position: "absolute", inset: 0, backgroundImage:
          "radial-gradient(circle, rgba(26,107,74,0.12) 1px, transparent 1px)",
          backgroundSize: "32px 32px", pointerEvents: "none" }} />
        {/* Soft glow */}
        <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translate(-50%,-50%)",
          width: "600px", height: "400px", borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(26,107,74,0.18) 0%, transparent 70%)",
          pointerEvents: "none" }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: "700px" }}>
          <div className="lp-fade-1" style={{ fontSize: "56px", marginBottom: "20px" }}>
            <span className="paw-float">🐾</span>
          </div>
          <div className="lp-fade-2" style={{ fontFamily: "'DM Sans', sans-serif",
            color: "#fff", fontSize: "clamp(32px, 8vw, 64px)", fontWeight: 600,
            letterSpacing: "2px", lineHeight: "1.15", marginBottom: "18px" }}>
            Professional Pet Care,<br />
            <em style={{ color: "#D4A843", fontStyle: "italic" }}>Done Right.</em>
          </div>
          <div className="lp-fade-3" style={{ fontFamily: "'DM Sans', sans-serif",
            color: "rgba(255,255,255,0.55)", fontSize: "clamp(10px, 1.5vw, 11px)", lineHeight: "2.2",
            marginBottom: "40px", fontWeight: 500, maxWidth: "600px", margin: "0 auto 40px",
            letterSpacing: "0.15em", textAlign: "center" }}>
            <div>INSURED & VETTED WALKERS &nbsp;·&nbsp; TRANSPARENT PRICING</div>
            <div>FREE 15-MIN MEET & GREET &nbsp;·&nbsp; YOUR PEACE OF MIND</div>
          </div>
          <div className="lp-fade-4 lp-hero-ctas">
            <button onClick={onSignUp} className="lp-cta-btn" style={{
              padding: "16px 40px", borderRadius: "12px", border: "none",
              background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
              boxShadow: "0 8px 24px rgba(26,107,74,0.30)",
            }}>Sign Up Now →</button>
            <button onClick={() => scrollTo("handoff")} className="lp-cta-btn" style={{
              padding: "16px 32px", borderRadius: "12px",
              border: "1.5px solid rgba(255,255,255,0.15)", background: "transparent",
              color: "rgba(255,255,255,0.8)", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 400, cursor: "pointer", letterSpacing: "0.3px",
            }}>How It Works</button>
          </div>

        </div>
      </section>


      {/* ── Logo Section ── */}
      <section style={{ background: "#0B1423", padding: "80px clamp(16px,5vw,40px)" }}>
        <div style={{ maxWidth: "820px", margin: "0 auto", display: "flex",
          flexDirection: "column", alignItems: "center", gap: "16px" }}>
          <LogoBadge size={140} />
          <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#D4A843",
            fontSize: "12px", letterSpacing: "0.5em", textTransform: "uppercase" }}>
            East Dallas
          </div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#F0E8D5",
            fontSize: "15px", letterSpacing: "0.2em", fontStyle: "italic" }}>
            Born here. Walk here.
          </div>
        </div>
      </section>

      {/* ── Services ── */}
      <section id="services" className="lp-section" style={{ background: "#f5f6f8" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", textAlign: "center" }}>
          <div className="section-divider" />
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "36px",
            fontWeight: 600, color: "#111827", marginBottom: "12px" }}>Our Services</div>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
            marginBottom: "56px", lineHeight: "1.7", maxWidth: "520px", margin: "0 auto 56px" }}>
            Whether you have a high-energy pup or an independent cat, we have a service tailored for them.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {[
              { icon: "🐕", color: "#C4541A", light: "#FDF5EC", border: "#D4A843",
                title: "Dog-walking", desc: "Your dog walks one-on-one with their dedicated walker — never in a large group, never rushed. Every walk is personalized to your dog's pace, personality, and needs, with flexible scheduling that fits your life." },
              { icon: "🐈", color: "#3D6B7A", light: "#EBF4F6", border: "#8EBCC6",
                title: "Cat-sitting", desc: "Your cat gets one-on-one attention from their dedicated sitter — in the comfort of home, on their own terms. Every visit is tailored to your cat's routine, with feeding, playtime, litter box care, and plenty of affection." },
              { icon: "🌙", color: "#7A4D6E", light: "#F5EFF3", border: "#C4A0B8",
                title: "Overnight Stays", desc: "When you're away overnight, your pet stays comfortable in their own home with a dedicated sitter by their side.\n\n🕖 Hours: 7 PM – 7 AM\n\n🏡 At our place — $100/night\n🔑 At your place — $150/night" },
              { icon: "🚗", color: "#b45309", light: "#fffbeb", border: "#fde68a",
                title: "Pet Transportation", desc: "Vet visit? Groomer calling? We'll handle the ride so you don't have to. Your pet travels safely and stress-free with someone they already trust — door to door, no detours.\n\n*Prices vary based on size and distance. Contact us for an estimate." },
            ].map(svc => (
              <div key={svc.title} className="lp-hover" style={{ background: "#fff",
                border: `1.5px solid ${svc.border}`, borderRadius: "20px",
                padding: "36px 32px", textAlign: "left",
                boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "12px" }}>
                  <div style={{ width: "56px", height: "56px", borderRadius: "14px", flexShrink: 0,
                    background: svc.light, display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: "28px" }}>{svc.icon}</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                    fontWeight: 600, color: "#111827", lineHeight: 1.2 }}>{svc.title}</div>
                </div>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                  color: "#6b7280", lineHeight: "1.7", whiteSpace: "pre-line" }}>{svc.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: "48px" }}>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              color: "#9ca3af", marginBottom: "16px" }}>
              Ready to get your pet on a schedule they'll love?
            </p>
            <button onClick={onSignUp} className="lp-cta-btn" style={{
              padding: "13px 36px", borderRadius: "10px", border: "none",
              background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: "16px", fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
            }}>Sign Up Now →</button>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="lp-section" style={{ background: "#fff" }}>
        <div style={{ maxWidth: "860px", margin: "0 auto", textAlign: "center" }}>
          <div className="section-divider" />
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "36px",
            fontWeight: 600, color: "#111827", marginBottom: "12px" }}>Transparent Pricing</div>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
            lineHeight: "1.7", maxWidth: "540px", margin: "0 auto 48px" }}>
            The more you book, the less you pay — and your whole week reprices when you unlock a new tier.
          </p>

          {/* Pricing cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px", marginBottom: "28px" }}>
            {[
              { label: "Easy Rider", freq: "1× per week", badge: null, badgeColor: null,
                price30: 30, price60: 45, save30: null, save60: null,
                bannerBg: "#f5f6f8", bannerFg: "#9ca3af",
                cardBorder: "#e4e7ec", cardBg: "#fff",
                nameFg: "#6b7280", lineFg: "#f3f4f6",
                durationFg: "#9ca3af", priceFg: "#111827", saveFg: null },
              { label: "Steady Stroll", freq: "3× per week", badge: "POPULAR", badgeColor: "#C4541A",
                price30: 27.50, price60: 42.50, save30: "save $2.50", save60: "save $2.50",
                bannerBg: "#C4541A", bannerFg: "#fff",
                cardBorder: "#1A1A1A", cardBg: "#1A1A1A",
                nameFg: "rgba(255,255,255,0.5)", lineFg: "rgba(255,255,255,0.1)",
                durationFg: "rgba(255,255,255,0.35)", priceFg: "#fff", saveFg: "#C4541A" },
              { label: "Full Gallop", freq: "5× per week", badge: "BEST VALUE", badgeColor: "#3D6B7A",
                price30: 25, price60: 40, save30: "save $5", save60: "save $5",
                bannerBg: "#3D6B7A", bannerFg: "#fff",
                cardBorder: "#3D6B7A", cardBg: "#fff",
                nameFg: "#6b7280", lineFg: "#f3f4f6",
                durationFg: "#9ca3af", priceFg: "#111827", saveFg: "#3D6B7A" },
            ].map(tier => (
              <div key={tier.label} style={{ borderRadius: "16px", overflow: "hidden",
                border: `2px solid ${tier.cardBorder}` }}>
                {/* Banner */}
                <div style={{ background: tier.bannerBg, padding: "10px 16px",
                  display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px",
                    fontWeight: 600, letterSpacing: "0.1em", color: tier.bannerFg }}>
                    {tier.freq}
                  </span>
                  {tier.badge && (
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "9px",
                      fontWeight: 600, letterSpacing: "0.1em", color: tier.bannerFg,
                      background: "rgba(255,255,255,0.2)", padding: "2px 8px",
                      borderRadius: "20px" }}>{tier.badge}</span>
                  )}
                </div>
                {/* Card body */}
                <div style={{ background: tier.cardBg, padding: "18px 18px 22px" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", fontWeight: 600,
                    letterSpacing: "0.12em", textTransform: "uppercase", color: tier.nameFg,
                    marginBottom: "14px" }}>{tier.label}</div>
                  <div style={{ height: "0.5px", background: tier.lineFg, marginBottom: "14px" }} />
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", padding: "5px 0" }}>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                      color: tier.durationFg }}>30 min</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                        fontWeight: 500, color: tier.priceFg }}>${tier.price30.toFixed(2)}</span>
                      {tier.save30 && <span style={{ fontFamily: "'DM Sans', sans-serif",
                        fontSize: "11px", fontWeight: 600, color: tier.saveFg }}>{tier.save30}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", padding: "5px 0" }}>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                      color: tier.durationFg }}>60 min</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px",
                        fontWeight: 500, color: tier.priceFg }}>${tier.price60.toFixed(2)}</span>
                      {tier.save60 && <span style={{ fontFamily: "'DM Sans', sans-serif",
                        fontSize: "11px", fontWeight: 600, color: tier.saveFg }}>{tier.save60}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af",
            letterSpacing: "0.05em", marginBottom: "48px" }}>
            Pricing resets weekly · Whole week reprices when you unlock a new tier
          </div>

          <button onClick={onSignUp} className="lp-cta-btn" style={{
            padding: "13px 36px", borderRadius: "10px", border: "none",
            background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
            fontSize: "16px", fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
          }}>Sign Up Now →</button>
        </div>
      </section>

      {/* ── How It Works / Meet & Greet ── */}
      <section id="handoff" className="lp-section" style={{ background: "#0B1423" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", textAlign: "center" }}>
          <div style={{ width: "48px", height: "3px", background: "#D4A843",
            borderRadius: "2px", margin: "0 auto 14px" }} />
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "36px",
            fontWeight: 600, color: "#fff", marginBottom: "12px" }}>How It Works</div>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#ffffffcc",
            marginBottom: "60px", lineHeight: "1.7", maxWidth: "520px", margin: "0 auto 60px" }}>
            We don't just show up and grab a leash. Every new client starts with a personal Meet & Greet 
            Appointment before any regular bookings begin.
          </p>

          {/* Steps */}
          <div style={{ marginBottom: "60px", position: "relative" }} className="lp-steps-grid">
            {[
              { step: "01", icon: "✍️", title: "Create Your Account",
                desc: "Sign up with your email and set a secure PIN. Takes under a minute." },
              { step: "02", icon: "🗓️", title: "Schedule Your Meet & Greet",
                desc: "Choose a day and 3-hour window for your free 15-minute in-home Meet & Greet. Your walker will reach out to confirm their exact arrival time." },
              { step: "03", icon: "🤝", title: "We Meet Your Pet",
                desc: "Your walker comes to you. We meet your dog or cat, learn their personality, and get comfortable together." },
              { step: "04", icon: "📋", title: "Share the Details",
                desc: "Walk preferences, dietary needs, feeding schedule, behavioral quirks — we want to know everything." },
              { step: "05", icon: "📅", title: "Start Booking",
                desc: "Once your Meet & Greet is complete, you're ready to book any service — any time, up to 8 weeks ahead." },
            ].map((s, i) => (
              <div key={s.step} style={{ background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px",
                padding: "28px 22px", textAlign: "left", position: "relative" }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#D4A843", fontWeight: 500, letterSpacing: "2px",
                  marginBottom: "12px" }}>STEP {s.step}</div>
                <div style={{ fontSize: "28px", marginBottom: "12px" }}>{s.icon}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                  fontWeight: 600, color: "#fff", marginBottom: "8px" }}>{s.title}</div>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#ffffffcc", lineHeight: "1.65" }}>{s.desc}</p>
              </div>
            ))}
          </div>

          {/* Meet & Greet highlight callout */}
          <div style={{ background: "rgba(26,107,74,0.15)", border: "1.5px solid rgba(26,107,74,0.35)",
            borderRadius: "20px", padding: "36px 32px", textAlign: "left",
            display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ fontSize: "40px", flexShrink: 0 }}>🤝</div>
            <div style={{ flex: 1, minWidth: "240px" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#fff", marginBottom: "10px" }}>
                The Meet & Greet Appointment
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
                color: "#ffffffcc", lineHeight: "1.75", marginBottom: "16px" }}>
                This is a free, 15-minute in-person meeting at your home before your first regular booking. 
                It's how we make sure your pet is comfortable with their walker, and how we get everything 
                we need to provide truly personalized care.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  "Meet your assigned walker face-to-face",
                  "Discuss your pet's dietary needs & feeding schedule",
                  "Share walking routes, leash preferences, and any behavioral notes",
                  "Hand over a spare key for future visits",
                  "Ask us anything — we're an open book",
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                    <div style={{ width: "18px", height: "18px", borderRadius: "50%",
                      background: "#C4541A", display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: "16px", color: "#fff",
                      flexShrink: 0, marginTop: "1px" }}>✓</div>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#ffffffcc", lineHeight: "1.5" }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: "52px" }}>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              color: "#ffffffaa", marginBottom: "16px" }}>
              Your pet's first walk is just a few steps away.
            </p>
            <button onClick={onSignUp} className="lp-cta-btn" style={{
              padding: "13px 36px", borderRadius: "10px",
              border: "1.5px solid rgba(255,255,255,0.25)",
              background: "rgba(26,107,74,0.6)", color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
              backdropFilter: "blur(4px)",
            }}>Sign Up Now →</button>
          </div>
        </div>
      </section>

      {/* ── Walk Updates ── */}
      <section className="lp-section" style={{ background: "#fff" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "52px" }}>
            <div className="section-divider" />
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "36px",
              fontWeight: 600, color: "#111827", marginBottom: "12px" }}>
              You're Always in the Loop
            </div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px",
              color: "#6b7280", lineHeight: "1.7", maxWidth: "520px", margin: "0 auto" }}>
              We know how hard it is to leave your pet behind. That's why we keep you connected — 
              with real updates, real photos, and real peace of mind throughout every walk.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "24px", marginBottom: "48px" }}>
            {[
              {
                icon: "📍",
                title: "Start & End Confirmation",
                desc: "Every walk starts with a short arrival video so you can see us greet your pup at the door. When we're done, we confirm the walk is complete — so you always know your pet is in good hands, even when you're in a meeting.",
              },
              {
                icon: "📸",
                title: "Photo Updates",
                desc: "Your walker sends candid photos during the walk so you can see exactly what your pet is up to — tail wags and all.",
              },
            ].map((item, i) => (
              <div key={i} style={{ background: "#f9fafb", borderRadius: "16px",
                padding: "28px 24px", border: "1.5px solid #f3f4f6" }}>
                <div style={{ fontSize: "32px", marginBottom: "14px" }}>{item.icon}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase",
                  letterSpacing: "1.5px", fontWeight: 600, color: "#111827", marginBottom: "8px" }}>
                  {item.title}
                </div>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  color: "#6b7280", lineHeight: "1.7", margin: 0 }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>


        </div>
      </section>

      {/* ── Team ── HIDDEN FOR NOW */}

      {/* Final CTA */}
      <section className="lp-section" style={{ background: "#f5f6f8" }}>
        <div style={{ maxWidth: "700px", margin: "0 auto" }}>
          <div style={{ background: "#0B1423", borderRadius: "24px", padding: "56px 40px",
            textAlign: "center", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0,
              backgroundImage: "radial-gradient(circle, rgba(26,107,74,0.15) 1px, transparent 1px)",
              backgroundSize: "28px 28px", pointerEvents: "none" }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ fontSize: "36px", marginBottom: "16px" }}>🐾</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", textTransform: "uppercase", letterSpacing: "1.5px",
                fontWeight: 600, color: "#fff", marginBottom: "14px", lineHeight: "1.2" }}>
                Ready to get started?
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                color: "#ffffffcc", lineHeight: "1.7", marginBottom: "32px",
                maxWidth: "380px", margin: "0 auto 32px" }}>
                Create your account, schedule your free Meet & Greet Appointment, and book your first walk —
                all in minutes.
              </p>
              <button onClick={onSignUp} className="lp-cta-btn" style={{
                padding: "17px 48px", borderRadius: "12px", border: "none",
                background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
                fontSize: "16px", fontWeight: 500, cursor: "pointer", letterSpacing: "0.3px",
                boxShadow: "0 8px 28px rgba(26,107,74,0.35)",
              }}>Sign Up Now →</button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      {/* Footer */}
      <footer style={{ background: "#0B1423", padding: "28px 24px", textAlign: "center" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa",
          fontSize: "15px", letterSpacing: "1px", marginBottom: "6px" }}>Lonestar Bark Co.</div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#D4A843",
          fontSize: "13px", letterSpacing: "0.4em", textTransform: "uppercase",
          marginBottom: "6px" }}>
          Born Here. Walk Here.
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffff44",
          fontSize: "13px", letterSpacing: "2px", textTransform: "uppercase" }}>
          East Dallas · Dallas, TX
        </div>
      </footer>
      </>)}
    </div>
  );
}


export default LandingPage;
