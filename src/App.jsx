import { useState, useEffect, useRef, useMemo } from "react";
import { FULL_DAYS, SERVICES } from "./constants.js";
import {
  loadClients, saveClients,
  loadWalkerProfiles, saveWalkerProfiles,
  loadInvoicesFromDB, mergeInvoicesIntoClients,
  loadTrades, saveTrades,
  sbFetch,
  loadAdminList, saveAdminList,
} from "./supabase.js";
import { GLOBAL_STYLES } from "./styles.js";
import LandingPage from "./components/LandingPage.jsx";
import RoleSelectScreen from "./components/auth/RoleSelectScreen.jsx";
import AuthScreen from "./components/auth/AuthScreen.jsx";
import WalkerAuthScreen, { getAllWalkers, injectCustomWalkers } from "./components/auth/WalkerAuthScreen.jsx";
import AdminAuthScreen from "./components/auth/AdminAuthScreen.jsx";
import BookingApp from "./components/client/BookingApp.jsx";
import WalkerDashboard from "./components/walker/WalkerDashboard.jsx";
import WalkerApplicationPage from "./components/walker/WalkerApplicationPage.jsx";
import AdminDashboard from "./components/admin/AdminDashboard.jsx";
import CustomerErrorBoundary from "./components/ErrorBoundary.jsx";
import { generateRecurringBookings, extendRecurringBookings } from "./components/recurring.js";
import HandoffFlow from "./components/HandoffFlow.jsx";
import { addrFromString, applySameDayDiscount, dateStrFromDate, getSessionPrice, repriceWeekBookings } from "./helpers.js";
import { SUPABASE_URL, notifyAdmin, updateInvoiceInDB, saveInvoiceToDB, sendWelcomeEmail, sendInvoicePaidEmail, sendPinResetCode, createRefund, sendBookingConfirmation, sendWalkerBookingNotification } from "./supabase.js";
import OfflineBanner from "./components/shared/OfflineBanner.jsx";

export default function LonestarBark() {
  // Ensure proper mobile viewport
  useEffect(() => {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
  }, []);



  const [clients, setClients] = useState({});
  const [walkerProfiles, setWalkerProfiles] = useState({});
  const [trades, setTrades] = useState([]);
  const [adminList, setAdminList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showApp, setShowApp] = useState(false);

  // Returning visitors skip the landing page and go straight to role select
  const [showLogin, setShowLogin] = useState(() => {
    try { return !!localStorage.getItem("dwi_has_visited"); } catch { return false; }
  });

  // Multi-role auth state
  // role: null | "customer" | "walker" | "admin"
  const [selectedRole, setSelectedRole] = useState(null);
  // The logged-in entity (customer client obj, walker obj, or admin obj)
  const [activeUser, setActiveUser] = useState(null);

  // Stamp the returning-visitor flag whenever anyone successfully logs in
  const handleLogin = (user) => {
    try { localStorage.setItem("dwi_has_visited", "1"); } catch {}
    setActiveUser(user);
  };

  useEffect(() => {
    // Check for email verification token in URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get("verify");
    const payment = params.get("payment");
    const invoiceId = params.get("invoice");
    const sessionId = params.get("session_id");
    const bookingClientId = params.get("clientId");
    const bookingKey = params.get("bookingKey");

    // ── Handle booking payment return ────────────────────────────────────────
    if (payment === "booking_success" && bookingClientId && bookingKey) {
      window.history.replaceState({}, "", window.location.pathname);
      const now = new Date().toISOString();
      let pendingKeys = [];
      try { pendingKeys = JSON.parse(localStorage.getItem("dwi_pending_booking_keys") || "[]"); localStorage.removeItem("dwi_pending_booking_keys"); } catch {}
      let returnClientId = "";
      try { returnClientId = localStorage.getItem("dwi_stripe_return_clientId") || ""; localStorage.removeItem("dwi_stripe_return_clientId"); } catch {}

      Promise.all([loadClients(), loadWalkerProfiles(), loadTrades(), loadInvoicesFromDB(), loadAdminList()]).then(async ([c, wp, tr, invRows, admins]) => {
        injectCustomWalkers(wp);
        const extended = extendRecurringBookings(c);
        if (extended !== c) saveClients(extended);
        const withInvoices = mergeInvoicesIntoClients(extended, invRows);
        setClients(withInvoices);
        setWalkerProfiles(wp);
        setTrades(tr);
        setAdminList(admins);

        const returningClient = withInvoices[bookingClientId] || withInvoices[returnClientId];
        if (returningClient) {
          // Mark matching bookings as confirmed and store stripeSessionId
          const keysToConfirm = pendingKeys.length > 0 ? pendingKeys : [bookingKey];
          const confirmedBookings = (returningClient.bookings || []).map(b =>
            keysToConfirm.includes(b.key)
              ? { ...b, status: "confirmed", paidAt: now, stripeSessionId: sessionId || null }
              : b
          );
          // Build paid invoice objects for each confirmed booking
          const confirmedNew = confirmedBookings.filter(b => keysToConfirm.includes(b.key));
          const newInvoices = confirmedNew.map((b, idx) => {
            const invoiceId = `stripe_${sessionId || Date.now()}_${idx}`;
            const svcLabel = b.service === "dog" ? "Dog Walk" : b.service === "cat" ? "Cat Visit" : "Meet & Greet";
            return {
              id: invoiceId,
              status: "paid",
              type: "walk",
              weekLabel: b.date || "",
              items: [{
                description: `${svcLabel} — ${b.day}, ${b.date} at ${b.slot?.time || "—"} (${b.slot?.duration || "—"})${b.form?.walker ? ` with ${b.form.walker}` : ""}`,
                amount: b.price || 0,
              }],
              subtotal: b.price || 0,
              total: b.price || 0,
              gratuity: 0,
              notes: `Paid via Stripe at booking. Session ID: ${sessionId || ""}`,
              createdAt: now,
              sentAt: now,
              paidAt: now,
              autoGenerated: true,
            };
          });

          // Merge new invoices into client state immediately so they're visible right away
          const confirmedClient = {
            ...returningClient,
            bookings: confirmedBookings,
            invoices: [...(returningClient.invoices || []), ...newInvoices],
          };
          const updatedClients = { ...withInvoices, [confirmedClient.id]: confirmedClient };
          setClients(updatedClients);
          try { await saveClients(updatedClients); } catch (e) { console.error("Failed to confirm booking:", e); }

          // Persist invoices to DB (fire and forget — state already updated above)
          newInvoices.forEach(inv => saveInvoiceToDB(inv, confirmedClient.id, returningClient.name, returningClient.email));

          setSelectedRole("customer");
          setShowApp(true);
          setActiveUser(confirmedClient);

          // Send confirmation emails for all newly confirmed bookings
          const assignedWalkerObj = Object.values(wp).find(w => w.name === confirmedNew[0]?.form?.walker);
          confirmedNew.forEach(b => {
            sendBookingConfirmation({
              clientName: returningClient.name, clientEmail: returningClient.email,
              service: b.service, date: b.date, day: b.day,
              time: b.slot?.time || b.form?.timeSlot?.label || "—",
              duration: b.slot?.duration || "—",
              walker: b.form?.walker || "", price: b.price || 0, pet: b.form?.pet || "",
            });
            if (assignedWalkerObj?.email) {
              sendWalkerBookingNotification({
                walkerName: assignedWalkerObj.name, walkerEmail: assignedWalkerObj.email,
                clientName: returningClient.name, pet: b.form?.pet || "",
                service: b.service, date: b.date, day: b.day,
                time: b.slot?.time || "—", duration: b.slot?.duration || "—", price: b.price || 0,
              });
            }
            notifyAdmin("new_booking", {
              clientName: returningClient.name, pet: b.form?.pet || "",
              date: b.date, time: b.slot?.time || "—", duration: b.slot?.duration || "—",
              walker: b.form?.walker || "Unassigned", price: b.price || 0,
            });
          });

          // Show booking confirmed banner
          try { localStorage.setItem("dwi_booking_confirmed", "1"); } catch {}
        }
        setLoading(false);
      }).catch(e => { console.error("Booking return load failed:", e); setLoading(false); });
      return;
    }

    // ── Handle booking payment cancelled ─────────────────────────────────────
    if (payment === "booking_cancelled" && bookingClientId) {
      window.history.replaceState({}, "", window.location.pathname);
      let pendingKeys = [];
      try { pendingKeys = JSON.parse(localStorage.getItem("dwi_pending_booking_keys") || "[]"); localStorage.removeItem("dwi_pending_booking_keys"); } catch {}
      let returnClientId = "";
      try { returnClientId = localStorage.getItem("dwi_stripe_return_clientId") || ""; localStorage.removeItem("dwi_stripe_return_clientId"); } catch {}

      Promise.all([loadClients(), loadWalkerProfiles(), loadTrades(), loadInvoicesFromDB(), loadAdminList()]).then(async ([c, wp, tr, invRows, admins]) => {
        injectCustomWalkers(wp);
        const extended = extendRecurringBookings(c);
        const withInvoices = mergeInvoicesIntoClients(extended, invRows);
        setClients(withInvoices);
        setWalkerProfiles(wp);
        setTrades(tr);
        setAdminList(admins);

        const returningClient = withInvoices[bookingClientId] || withInvoices[returnClientId];
        if (returningClient) {
          const keysToRemove = pendingKeys.length > 0 ? pendingKeys : [bookingKey];
          const cleanedBookings = (returningClient.bookings || []).filter(b => !keysToRemove.includes(b.key));
          const cleanedClient = { ...returningClient, bookings: cleanedBookings };
          const updatedClients = { ...withInvoices, [cleanedClient.id]: cleanedClient };
          setClients(updatedClients);
          try { await saveClients(updatedClients); } catch {}
          setSelectedRole("customer");
          setShowApp(true);
          setActiveUser(cleanedClient);
          try { localStorage.setItem("dwi_booking_cancelled", "1"); } catch {}
        }
        setLoading(false);
      }).catch(e => { console.error("Booking cancel return failed:", e); setLoading(false); });
      return;
    }

    // ── Handle invoice payment return ────────────────────────────────────────
    if (payment === "success" && invoiceId) {
      window.history.replaceState({}, "", window.location.pathname);
      const now = new Date().toISOString();
      // Read any stored gratuity for this invoice
      let gratuityAmount = 0;
      try {
        const stored = localStorage.getItem("dwi_stripe_gratuity");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.invoiceId === invoiceId) gratuityAmount = parsed.amount || 0;
          localStorage.removeItem("dwi_stripe_gratuity");
        }
      } catch {}
      // Update invoices table directly
      updateInvoiceInDB(invoiceId, { status: "paid", paidAt: now, ...(gratuityAmount > 0 ? { gratuity: gratuityAmount } : {}) });

      // Try to fetch card details from Stripe session (requires get-payment-details edge fn)
      const fetchCardDetails = async () => {
        if (!sessionId) return null;
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/get-payment-details`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
          if (!res.ok) return null;
          const data = await res.json();
          // expects { last4, brand } e.g. { last4: "4242", brand: "visa" }
          return data?.last4 ? data : null;
        } catch { return null; }
      };

      fetchCardDetails().then(cardDetails => {
        // Store success banner data including card details if available
        try {
          localStorage.setItem("dwi_payment_success", JSON.stringify({
            invoiceId, paidAt: now,
            last4: cardDetails?.last4 || null,
            brand: cardDetails?.brand || null,
            gratuity: gratuityAmount || 0,
          }));
        } catch {}
      });
      // Retrieve stored client ID for auto-login
      let returnClientId = "";
      try { returnClientId = localStorage.getItem("dwi_stripe_return_clientId") || ""; localStorage.removeItem("dwi_stripe_return_clientId"); } catch {}
      if (returnClientId) {
        // Load fresh data then auto-login the client
        Promise.all([loadClients(), loadWalkerProfiles(), loadTrades(), loadInvoicesFromDB(), loadAdminList()]).then(([c, wp, tr, invRows, admins]) => {
          injectCustomWalkers(wp);
          const extended = extendRecurringBookings(c);
          if (extended !== c) saveClients(extended);
          const withInvoices = mergeInvoicesIntoClients(extended, invRows);
          setClients(withInvoices);
          setWalkerProfiles(wp);
          setTrades(tr);
          setAdminList(admins);
          setLoading(false);
          // Auto-login the returning client
          const returningClient = withInvoices[returnClientId];
          if (returningClient) {
            setSelectedRole("customer");
            setShowApp(true);
            setActiveUser(returningClient);
            // Send invoice paid confirmation email
            const paidInvoice = (returningClient.invoices || []).find(inv => inv.id === invoiceId);
            if (paidInvoice) {
              sendInvoicePaidEmail({
                clientName: returningClient.name,
                clientEmail: returningClient.email,
                amount: paidInvoice.total,
                invoiceId,
                paidAt: now,
              });
            }
          }
        }).catch(e => { console.error("Stripe return load failed:", e); setLoading(false); });
        return; // Skip the second Promise.all below
      }
    } else if (payment === "cancelled") {
      window.history.replaceState({}, "", window.location.pathname);
      try { localStorage.setItem("dwi_payment_cancelled", "1"); } catch {}
      // Retrieve stored client ID for auto-login on cancel too
      let returnClientId = "";
      try { returnClientId = localStorage.getItem("dwi_stripe_return_clientId") || ""; localStorage.removeItem("dwi_stripe_return_clientId"); } catch {}
      if (returnClientId) {
        Promise.all([loadClients(), loadWalkerProfiles(), loadTrades(), loadInvoicesFromDB(), loadAdminList()]).then(([c, wp, tr, invRows, admins]) => {
          injectCustomWalkers(wp);
          const extended = extendRecurringBookings(c);
          if (extended !== c) saveClients(extended);
          const withInvoices = mergeInvoicesIntoClients(extended, invRows);
          setClients(withInvoices);
          setWalkerProfiles(wp);
          setTrades(tr);
          setAdminList(admins);
          setLoading(false);
          const returningClient = withInvoices[returnClientId];
          if (returningClient) {
            setSelectedRole("customer");
            setShowApp(true);
            setActiveUser(returningClient);
          }
        }).catch(e => { console.error("Stripe cancel load failed:", e); setLoading(false); });
        return;
      }
    }

    if (token) {
      (async () => {
        try {
          const rows = await sbFetch(
            `verification_tokens?token=eq.${encodeURIComponent(token)}&select=email,expires_at`
          );
          if (!rows || rows.length === 0) {
            alert("This verification link is invalid or has already been used.");
          } else {
            const { email, expires_at } = rows[0];
            if (new Date(expires_at) < new Date()) {
              alert("This verification link has expired. Please sign up again to get a new one.");
            } else {
              // Mark client as verified in Supabase
              const allClients = await loadClients();
              const match = Object.values(allClients).find(c => c.email === email);
              if (match) {
                const updated = { ...allClients, [match.id]: { ...match, emailVerified: true } };
                await saveClients(updated);
                setClients(updated);
              }
              // Delete the used token
              await sbFetch(`verification_tokens?token=eq.${encodeURIComponent(token)}`, {
                method: "DELETE", headers: { "Prefer": "" },
              });
              // Clean URL and show success
              window.history.replaceState({}, "", window.location.pathname);
              alert("✅ Your email has been verified! You can now log in.");
            }
          }
        } catch (e) {
          console.error("Verification error:", e);
        }
      })();
    }

    Promise.all([loadClients(), loadWalkerProfiles(), loadTrades(), loadInvoicesFromDB(), loadAdminList()]).then(([c, wp, tr, invRows, admins]) => {
      // Inject any admin-created walkers into runtime registries
      injectCustomWalkers(wp);
      // Extend recurring booking instances forward as weeks roll by
      const extended = extendRecurringBookings(c);
      if (extended !== c) saveClients(extended);
      // Merge invoices from dedicated table into client objects
      const withInvoices = mergeInvoicesIntoClients(extended, invRows);
      setClients(withInvoices);
      setWalkerProfiles(wp);
      setTrades(tr);
      setAdminList(admins);
      setLoading(false);
    }).catch(e => { console.error("Initial data load failed:", e); setLoading(false); });
  }, []);

  const [pendingVerification, setPendingVerification] = useState(null); // { name, email } while awaiting verification

  // ── Customer handlers (unchanged from original) ──────────────────────────
  const handleCustomerLogin = (c) => handleLogin(c);

  const handleRegister = async (newClient) => {
    const updated = { ...clients, [newClient.id]: newClient };
    setClients(updated);
    saveClients(updated);
    // Show "check your email" screen immediately — don't wait for the email to send
    setPendingVerification({ name: newClient.name, email: newClient.email });
    // Fire verification + welcome emails in background
    fetch(`${SUPABASE_URL}/functions/v1/send-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newClient.email, clientName: newClient.name }),
    }).catch(e => console.error("Failed to send verification email:", e));
    sendWelcomeEmail(newClient.name, newClient.email);
    // Notify admins
    const pets = [...(newClient.dogs || []), ...(newClient.cats || [])].join(", ");
    notifyAdmin("new_client", { name: newClient.name, email: newClient.email, pets });
  };

  const handleHandoffComplete = (handoffData) => {
    const client = clients[activeUser.id] || activeUser;
    let bookings = client.bookings || [];
    if (handoffData.followOnWalk) {
      const fw = handoffData.followOnWalk;
      const apptDate = new Date(fw.date);
      apptDate.setHours(fw.hour, fw.minute, 0, 0);
      const pet = (client.dogs || client.pets || [])[0] || (client.cats || [])[0] || "";
      const followOnBooking = {
        key: `dog-${apptDate.toISOString().slice(0, 10)}-firstwalk`,
        service: "dog",
        day: FULL_DAYS[fw.dayOfWeek],
        date: dateStrFromDate(apptDate),
        slot: { id: "firstwalk", time: fw.slotTime, duration: fw.duration },
        form: {
          name: client.name || "", pet,
          email: client.email, phone: client.phone || "",
          address: client.address || "", walker: handoffData.handoffWalker || "",
          notes: "", additionalDogs: [],
        },
        bookedAt: new Date().toISOString(),
        scheduledDateTime: apptDate.toISOString(),
        additionalDogCount: 0, additionalDogCharge: 0,
        price: getSessionPrice(fw.duration, 1), priceTier: "Easy Rider", isFirstWalk: true,
      };
      bookings = applySameDayDiscount(repriceWeekBookings([...bookings, followOnBooking]));
    }
    const updated = {
      ...client, handoffDone: true, handoffConfirmed: false, handoffInfo: handoffData, bookings,
      phone: handoffData.handoffPhone || client.phone || "",
      address: handoffData.handoffAddress || client.address || "",
      addrObj: handoffData.handoffAddrObj || client.addrObj || addrFromString(handoffData.handoffAddress || client.address || ""),
      preferredWalker: handoffData.handoffWalker || client.preferredWalker || "",
      keyholder: handoffData.handoffWalker || client.keyholder || "",
    };
    const updatedClients = { ...clients, [client.id]: updated };
    setClients(updatedClients);
    saveClients(updatedClients);
    setActiveUser(updated);
  };

  const handleSetClients = (updated) => {
    setClients(updated);
    if (activeUser && activeUser.role !== "walker" && activeUser.role !== "admin" && updated[activeUser.id]) {
      setActiveUser(updated[activeUser.id]);
    }
  };

  // ── Global logout ─────────────────────────────────────────────────────────
  const handleLogout = () => {
    setActiveUser(null);
    setSelectedRole(null);
    setShowApp(false);
    // Returning visitors go straight back to the login/role screen
    const isReturning = (() => { try { return !!localStorage.getItem("dwi_has_visited"); } catch { return false; } })();
    setShowLogin(isReturning);
  };

  // ── Loading splash ────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0B1423", display: "flex",
      alignItems: "center", justifyContent: "center" }}>
      <style>{GLOBAL_STYLES}</style>
      <OfflineBanner />
      <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#ffffffaa", fontSize: "16px" }}>Loading…</div>
    </div>
  );

  // ── Email verification pending screen ─────────────────────────────────────
  if (pendingVerification) return (
    <div style={{ minHeight: "100vh", background: "#0B1423", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ background: "#111827", borderRadius: "20px", padding: "40px 32px",
        maxWidth: "420px", width: "100%", textAlign: "center",
        border: "1.5px solid #1f2937", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>📬</div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
          fontSize: "22px", color: "#fff", marginBottom: "12px" }}>
          Check your email
        </div>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
          color: "#9ca3af", lineHeight: "1.7", marginBottom: "24px" }}>
          We sent a verification link to <strong style={{ color: "#fff" }}>{pendingVerification.email}</strong>.
          Click the link in that email to activate your account.
        </p>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
          color: "#6b7280", marginBottom: "24px" }}>
          The link expires in 24 hours. Check your spam folder if you don't see it.
        </p>
        <button onClick={() => setPendingVerification(null)}
          style={{ width: "100%", padding: "13px", borderRadius: "10px", border: "none",
            background: "#C4541A", color: "#fff", fontFamily: "'DM Sans', sans-serif",
            fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
          Back to Login
        </button>
      </div>
    </div>
  );

  // ── Landing page (public) ─────────────────────────────────────────────────
  if (!showApp && !showLogin) return <><OfflineBanner /><LandingPage onSignUp={() => { setSelectedRole("customer"); setShowApp(true); }} onLogin={() => setShowLogin(true)} walkerProfiles={walkerProfiles} /></>;

  // ── Role selection (via Login button) ─────────────────────────────────────
  if (showLogin && !selectedRole) return <RoleSelectScreen onSelectRole={(role) => { setSelectedRole(role); setShowApp(true); }} onBack={() => setShowLogin(false)} />;

  // ── ADMIN flow ────────────────────────────────────────────────────────────
  if (selectedRole === "admin") {
    if (!activeUser) return (
      <AdminAuthScreen
        onLogin={handleLogin}
        onBack={() => setSelectedRole(null)}
        onBackToLanding={() => { setSelectedRole(null); setShowApp(false); setShowLogin(false); }}
        adminList={adminList}
        setAdminList={(updated) => { setAdminList(updated); saveAdminList(updated); }}
        onRequestPinReset={async (email) => {
          const admin = adminList.find(a => a.email?.toLowerCase() === email.toLowerCase() && a.status === "active");
          if (!admin) return false;
          const code = String(Math.floor(100000 + Math.random() * 900000));
          const expiry = Date.now() + 15 * 60 * 1000;
          const updated = adminList.map(a => a.id === admin.id ? { ...a, resetCode: code, resetCodeExpiry: expiry } : a);
          setAdminList(updated);
          saveAdminList(updated);
          await sendPinResetCode({ name: admin.name, email: admin.email, code });
          return true;
        }}
        onVerifyPinReset={(email, code) => {
          const admin = adminList.find(a => a.email?.toLowerCase() === email.toLowerCase() && a.status === "active");
          if (!admin || !admin.resetCode) return false;
          if (admin.resetCode !== code) return false;
          if (Date.now() > admin.resetCodeExpiry) return false;
          return true;
        }}
      />
    );
    return (
      <AdminDashboard
        admin={activeUser}
        setAdmin={(updated) => setActiveUser(updated)}
        clients={clients}
        setClients={(updated) => { setClients(updated); saveClients(updated); }}
        walkerProfiles={walkerProfiles}
        setWalkerProfiles={(updated) => { setWalkerProfiles(updated); saveWalkerProfiles(updated); }}
        trades={trades}
        setTrades={(updated) => { setTrades(updated); saveTrades(updated); }}
        adminList={adminList}
        setAdminList={(updated) => { setAdminList(updated); saveAdminList(updated); }}
        onLogout={handleLogout}
      />
    );
  }

  // ── WALKER flow ───────────────────────────────────────────────────────────
  if (selectedRole === "walker") {
    if (!activeUser) return (
      <WalkerAuthScreen
        onLogin={handleLogin}
        onBack={() => setSelectedRole(null)}
        onBackToLanding={() => { setSelectedRole(null); setShowApp(false); setShowLogin(false); }}
        onSetPin={(email, pin) => {
          const updated = { ...walkerProfiles };
          const entry = Object.values(updated).find(p => p.email?.toLowerCase() === email);
          if (entry) {
            updated[entry.id] = { ...entry, pin, mustSetPin: false, resetCode: null, resetCodeExpiry: null };
            setWalkerProfiles(updated);
            saveWalkerProfiles(updated);
          }
        }}
        onRequestPinReset={async (email) => {
          const entry = Object.values(walkerProfiles).find(p => p.email?.toLowerCase() === email.toLowerCase());
          if (!entry) return false;
          const code = String(Math.floor(100000 + Math.random() * 900000));
          const expiry = Date.now() + 15 * 60 * 1000;
          const updated = { ...walkerProfiles, [entry.id]: { ...entry, resetCode: code, resetCodeExpiry: expiry } };
          setWalkerProfiles(updated);
          saveWalkerProfiles(updated);
          await sendPinResetCode({ name: entry.name, email: entry.email, code });
          return true;
        }}
        onVerifyPinReset={(email, code) => {
          const entry = Object.values(walkerProfiles).find(p => p.email?.toLowerCase() === email.toLowerCase());
          if (!entry || !entry.resetCode) return false;
          if (entry.resetCode !== code) return false;
          if (Date.now() > entry.resetCodeExpiry) return false;
          return true;
        }}
      />
    );
    return (
      <WalkerDashboard
        walker={activeUser}
        clients={clients}
        setClients={(updated) => { setClients(updated); saveClients(updated); }}
        walkerProfiles={walkerProfiles}
        setWalkerProfiles={(updated) => { setWalkerProfiles(updated); saveWalkerProfiles(updated); }}
        trades={trades}
        setTrades={(updated) => { setTrades(updated); saveTrades(updated); }}
        onLogout={handleLogout}
      />
    );
  }

  // ── CUSTOMER flow ─────────────────────────────────────────────────────────
  if (!activeUser) return (
    <CustomerErrorBoundary>
      <OfflineBanner />
      <AuthScreen
        clients={clients}
        onLogin={handleCustomerLogin}
        onRegister={handleRegister}
        onBack={() => { setSelectedRole(null); setShowApp(false); setShowLogin(true); }}
        onBackToLanding={() => { setSelectedRole(null); setShowApp(false); setShowLogin(false); }}
        onSetPin={(clientId, pin) => {
          const updated = { ...clients };
          if (updated[clientId]) {
            updated[clientId] = { ...updated[clientId], pin, mustSetPin: false, resetCode: null, resetCodeExpiry: null };
            setClients(updated);
            saveClients(updated);
          }
        }}
        onRequestPinReset={async (email) => {
          const client = Object.values(clients).find(c => c.email?.toLowerCase() === email.toLowerCase());
          if (!client) return false;
          const code = String(Math.floor(100000 + Math.random() * 900000));
          const expiry = Date.now() + 15 * 60 * 1000;
          const updated = { ...clients, [client.id]: { ...client, resetCode: code, resetCodeExpiry: expiry } };
          setClients(updated);
          saveClients(updated);
          await sendPinResetCode({ name: client.name, email: client.email, code });
          return true;
        }}
        onVerifyPinReset={(email, code) => {
          const client = Object.values(clients).find(c => c.email?.toLowerCase() === email.toLowerCase());
          if (!client || !client.resetCode) return false;
          if (client.resetCode !== code) return false;
          if (Date.now() > client.resetCodeExpiry) return false;
          return true;
        }}
      />
    </CustomerErrorBoundary>
  );
  if (!activeUser.handoffDone) return (
    <CustomerErrorBoundary>
      <HandoffFlow client={activeUser} onComplete={handleHandoffComplete} walkerProfiles={walkerProfiles} />
    </CustomerErrorBoundary>
  );
  return (
    <CustomerErrorBoundary>
      <BookingApp
        client={clients[activeUser.id] || activeUser}
        onLogout={handleLogout}
        clients={clients}
        setClients={handleSetClients}
        walkerProfiles={walkerProfiles}
      />
    </CustomerErrorBoundary>
  );
}
