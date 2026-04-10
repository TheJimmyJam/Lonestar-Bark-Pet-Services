// ─── Shared Styles ────────────────────────────────────────────────────────────
const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; overflow-x: hidden; }
  body { overflow-x: hidden; max-width: 100%; }
  @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  @keyframes pop { 0%{transform:scale(0.85);opacity:0} 70%{transform:scale(1.06)} 100%{transform:scale(1);opacity:1} }
  @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  .fade-up { animation: fadeUp 0.28s ease forwards; }
  .pop { animation: pop 0.38s cubic-bezier(.34,1.56,.64,1) forwards; }
  .shake { animation: shake 0.5s ease forwards; }
  .key-btn { transition: all 0.12s ease !important; }
  .key-btn:hover { background: #6B4420 !important; }
  .key-btn:active { transform: scale(0.91) !important; }
  .slot-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,0.10) !important; }
  .slot-btn { transition: all 0.15s ease !important; }
  .hover-card:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.10) !important; }
  .hover-card { transition: all 0.15s ease !important; }
  .sticky-nav { position: -webkit-sticky; position: sticky; top: 0; z-index: 10; }
  input:focus, textarea:focus, select:focus { outline: none; }

  /* ── Tooltips ── */
  [data-tooltip] { position: relative; }
  [data-tooltip]::before {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%) scale(0.92);
    background: #0B1423;
    color: #fff;
    padding: 5px 10px;
    border-radius: 7px;
    font-size: 11px;
    font-family: 'DM Sans', sans-serif;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.14s, transform 0.14s;
    z-index: 9999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
  }
  [data-tooltip]::after {
    content: '';
    position: absolute;
    bottom: calc(100% + 2px);
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: #0B1423;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.14s;
    z-index: 9999;
  }
  [data-tooltip]:hover::before, [data-tooltip]:hover::after {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }

  /* ── Responsive layout ── */

  /* App content containers: mobile-first, wider on desktop */
  .app-container {
    max-width: 560px;
    margin: 0 auto;
    padding: 24px 16px 32px;
    width: 100%;
  }
  @media (min-width: 768px) {
    .app-container { padding: 36px 24px 40px; }
  }
  @media (min-width: 1024px) {
    .app-container { max-width: 680px; padding: 40px 32px 40px; }
  }

  /* Pricing tiers: single col mobile, 3-col desktop */
  .pricing-tiers-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 32px;
  }
  @media (min-width: 680px) {
    .pricing-tiers-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
    }
  }

  /* My Walks week summary header: stack on mobile, row on desktop */
  .week-summary-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  @media (min-width: 480px) {
    .week-summary-header {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
    }
  }

  /* Booking form: single col always, but more breathing room on desktop */
  .booking-form { width: 100%; }
  @media (min-width: 768px) {
    .booking-form { font-size: 15px; }
  }

  /* Slot list: comfortable on all sizes */
  .slot-list {
    max-height: 380px;
    overflow-y: auto;
    padding-right: 2px;
  }
  @media (min-width: 600px) {
    .slot-list { max-height: 480px; }
  }

  /* Auth card: compact on mobile, slightly wider on desktop */
  .auth-card {
    width: 100%;
    max-width: 380px;
  }
  @media (min-width: 480px) {
    .auth-card { max-width: 420px; }
  }

  /* PIN pad keys: slightly larger tap targets on desktop */
  .pin-key {
    width: 68px;
    height: 68px;
  }
  @media (min-width: 480px) {
    .pin-key { width: 76px; height: 76px; }
  }

  /* Nav tabs: allow scroll on very small screens */
  .nav-tabs {
    display: flex;
    justify-content: center;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .nav-tabs::-webkit-scrollbar { display: none; }

  /* Day selector: always scrollable */
  .day-selector {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 4px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .day-selector::-webkit-scrollbar { display: none; }
  .day-selector button { flex-shrink: 0; }

  /* Landing page nav links: always hidden — hamburger used instead */
  .lp-nav-links { display: none; }

  /* Landing page sections: tighter padding on mobile */
  .lp-section {
    padding: 64px 20px;
  }
  @media (min-width: 768px) {
    .lp-section { padding: 96px 24px; }
  }

  /* Landing pricing grid: stack on mobile */
  .lp-pricing-grid {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 32px;
  }
  @media (min-width: 680px) {
    .lp-pricing-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
    }
  }

  /* Landing services grid: stack on mobile, 2×2 on wider screens */
  .lp-services-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  /* Landing how-it-works steps: 1-col mobile, 2-col tablet, 3-col desktop */
  .lp-steps-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    margin-bottom: 48px;
  }
  @media (min-width: 540px) {
    .lp-steps-grid { grid-template-columns: 1fr 1fr; }
  }
  @media (min-width: 900px) {
    .lp-steps-grid { grid-template-columns: 1fr 1fr 1fr; }
  }

  /* Landing hero CTA buttons: stack on mobile, row on wider */
  .lp-hero-ctas {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }
  @media (min-width: 480px) {
    .lp-hero-ctas { flex-direction: row; justify-content: center; }
  }

  /* Bottom sheet: full width on mobile, capped on desktop */
  .bottom-sheet {
    background: #fff;
    border-radius: 24px 24px 0 0;
    width: 100%;
    max-width: 560px;
    padding: 28px 20px 48px;
    max-height: 90vh;
    overflow-y: auto;
  }
  @media (min-width: 600px) {
    .bottom-sheet { padding: 32px 28px 52px; border-radius: 28px 28px 0 0; }
  }

  /* Touch-friendly tap targets */
  @media (max-width: 480px) {
    button { min-height: 40px; }
    input, select, textarea { font-size: 16px !important; } /* prevent iOS zoom */
  }
`;




export { GLOBAL_STYLES };
