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
import { addrFromString, awardPunchCard, dateStrFromDate, getSessionPrice } from "./helpers.js";
import { SUPABASE_URL, notifyAdmin, updateInvoiceInDB, sendWelcomeEmail, sendInvoicePaidEmail, sendPinResetCode, createRefund, sendBookingConfirmation, sendWalkerBookingNotification, createBookingCheckout, authOnChange, authGetSession, authSignOut, loadClientByUserId, synthPinFromUserId } from "./supabase.js";
import PasswordResetScreen from "./components/auth/PasswordResetScreen.jsx";
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
  // Ref that stays current inside the authOnChange closure (which captures
  // selectedRole as null at mount due to the [] dependency array).
  const selectedRoleRef = useRef(null);
  // Ref to adminList — kept current so handleSession can check admin status
  // without being inside the adminList state closure.
  const adminListRef = useRef([]);
  // The logged-in entity (customer client obj, walker obj, or admin obj)
  const [activeUser, setActiveUser] = useState(null);
  // Supabase Auth session info — clients only. Staff still use PIN.
  const [authSession, setAuthSession] = useState(null);
  // When a Supabase Auth user signs in but has no matching `clients` row yet
  // (e.g. fresh Google OAuth signup), we stash the auth user here so
  // AuthScreen jumps to the name/pets form.
  const [pendingRegistration, setPendingRegistration] = useState(null);
  // True when Supabase fires the PASSWORD_RECOVERY event (user clicked the
  // reset link in their email). Shows PasswordResetScreen instead of normal flow.
  const [recoveryMode, setRecoveryMode] = useState(false);
  // True when the recovery link came from the admin "Forgot password" flow
  // (distinguished by ?admin_reset=1 query param, which Supabase preserves).
  const [isAdminReset, setIsAdminReset] = useState(false);

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

        // ── Stamp paidAt + stripeSessionId on raw DB data BEFORE extendRecurringBookings ──
        // extendRecurringBookings reprices flat-rate bookings.
        // Confirm payments before this call so Stripe-paid prices are locked first.
        const keysToConfirm = pendingKeys.length > 0 ? pendingKeys : [bookingKey];
        const pinKey = bookingClientId || returnClientId;
        const rawReturningClient = c[bookingClientId] || c[returnClientId];
        let cWithConfirmed = c;
        if (rawReturningClient) {
          const preConfirmedBookings = (rawReturningClient.bookings || []).map(b =>
            keysToConfirm.includes(b.key)
              ? {
                  ...b,
                  status: "confirmed",
                  ...(sessionId
                    ? { paidAt: now, stripeSessionId: sessionId }
                    : {}), // no sessionId → don't mark as paid; admin can resolve manually
                }
              : b
          );
          cWithConfirmed = { ...c, [pinKey]: { ...rawReturningClient, bookings: preConfirmedBookings } };
        }

        const extended = extendRecurringBookings(cWithConfirmed);
        if (extended !== cWithConfirmed) saveClients(extended);
        const withInvoices = mergeInvoicesIntoClients(extended, invRows);
        setClients(withInvoices);
        setWalkerProfiles(wp);
        setTrades(tr);
        setAdminList(admins);

        const returningClient = withInvoices[bookingClientId] || withInvoices[returnClientId];
        if (returningClient) {
          // Booking already confirmed in pre-confirmation step above.
          // Build confirmedNew list for walker notifications.
          const confirmedNew = (returningClient.bookings || []).filter(b => keysToConfirm.includes(b.key));

          // Stripe-paid receipts live on the booking itself (stripeSessionId + paidAt).
          // No separate invoice DB record needed — ClientInvoicesPage reads from bookings directly.

          // Award a punch card punch for each confirmed (paid) booking — guarded against double-award.
          let clientWithPunches = returningClient;
          for (const b of confirmedNew) {
            clientWithPunches = awardPunchCard(clientWithPunches, b);
          }

          const confirmedClient = clientWithPunches;
          const updatedClients = { ...withInvoices, [pinKey]: clientWithPunches };
          setClients(updatedClients);
          try { await saveClients(updatedClients); } catch (e) { console.error("Failed to confirm booking:", e); }

          setSelectedRole("customer");
          setShowApp(true);
          setActiveUser(confirmedClient);

          // Client confirmation + admin notification are sent server-side by the stripe-webhook.
          // Only fire the walker notification here (requires walkerProfiles lookup).
          const assignedWalkerObj = Object.values(wp).find(w => w.name === confirmedNew[0]?.form?.walker);
          if (assignedWalkerObj?.email) {
            confirmedNew.forEach(b => {
              sendWalkerBookingNotification({
                walkerName: assignedWalkerObj.name, walkerEmail: assignedWalkerObj.email,
                clientName: returningClient.name, pet: b.form?.pet || "",
                service: b.service, date: b.date, day: b.day,
                time: b.slot?.time || "—", duration: b.slot?.duration || "—", price: b.price || 0,
              });
            });
          }

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
          const cancelledPinKey = bookingClientId || returnClientId;
          const updatedClients = { ...withInvoices, [cancelledPinKey]: cleanedClient };
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

  // ── Supabase Auth session listener (clients only) ────────────────────────
  // Admin and walker flows still use PIN auth and are unaffected.
  // Keep refs in sync so closures inside the [] effects always see current values.
  useEffect(() => { selectedRoleRef.current = selectedRole; }, [selectedRole]);
  useEffect(() => { adminListRef.current = adminList; }, [adminList]);

  useEffect(() => {
    let cancelled = false;

    const handleSession = async (session) => {
      if (cancelled) return;
      setAuthSession(session);
      if (!session?.user) return;

      const user = session.user;

      // ── Admin session guard ──────────────────────────────────────────────
      // Admins keep their Supabase session alive so sbFetch sends their JWT
      // and RLS can identify them. Check adminListRef before routing so that:
      //   a) A SIGNED_IN event during the admin login flow routes to admin, not client
      //   b) On page refresh, an existing admin session is restored correctly
      const adminEntry = adminListRef.current?.find(
        a => a.email.toLowerCase() === user.email.toLowerCase() && a.status === "active"
      );
      if (adminEntry) {
        // Admin — restore their session if they're not already in the app
        if (!selectedRoleRef.current) {
          setSelectedRole("admin");
          setShowApp(true);
          setActiveUser({ id: adminEntry.id, name: adminEntry.name, role: "admin", email: adminEntry.email });
        }
        return;
      }

      // ── Client session guard ─────────────────────────────────────────────
      // Don't hijack walker or admin flows that are already in progress.
      const currentRole = selectedRoleRef.current;
      if (currentRole && currentRole !== "customer") return;

      const existing = await loadClientByUserId(user.id);
      if (cancelled) return;
      if (existing) {
        // Returning client — route straight into the portal.
        setSelectedRole("customer");
        setShowApp(true);
        setActiveUser(existing);
        setPendingRegistration(null);
      } else {
        // Fresh signup (usually Google OAuth) — show name/pets form.
        setSelectedRole("customer");
        setShowApp(true);
        setPendingRegistration({
          user_id: user.id,
          email: user.email || "",
          firstName: user.user_metadata?.given_name || user.user_metadata?.name?.split(" ")[0] || "",
          lastName: user.user_metadata?.family_name || user.user_metadata?.name?.split(" ").slice(1).join(" ") || "",
        });
      }
    };

    // Pick up any existing session on mount
    authGetSession().then(handleSession);

    // Subscribe to auth changes
    const subscription = authOnChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        // Detect admin vs client reset via ?admin_reset=1 query param.
        // AdminAuthScreen sets redirectTo: origin + "/?admin_reset=1" so
        // Supabase appends the token hash while preserving the query string.
        setIsAdminReset(window.location.search.includes("admin_reset"));
        setRecoveryMode(true);
        return;
      }
      if (event === "SIGNED_OUT") {
        setAuthSession(null);
        setPendingRegistration(null);
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        await handleSession(session);
      }
    });

    return () => {
      cancelled = true;
      if (subscription && typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ── New-client registration via Supabase Auth ────────────────────────────
  // Called from AuthScreen after the user completes the name/pets form.
  // `profile` = { firstName, lastName, name, dogs, cats }
  // `pending` = { user_id, email, ... } or null (falls back to current session)
  const handleRegister = async (profile, pending) => {
    const session = authSession || (await authGetSession());
    const user = pending || session?.user || null;
    const userId = pending?.user_id || session?.user?.id;
    const email = (pending?.email || session?.user?.email || "").toLowerCase();
    if (!userId || !email) {
      console.error("handleRegister: no auth session/user available");
      return;
    }

    // Synthetic PIN so the clients map keyed by PIN keeps working
    const pinKey = synthPinFromUserId(userId);
    const newClient = {
      id: `c_${Date.now()}`,
      user_id: userId,
      email,
      pin: pinKey,
      firstName: profile.firstName,
      lastName: profile.lastName,
      name: profile.name || `${profile.firstName} ${profile.lastName}`.trim(),
      dogs: profile.dogs || [],
      cats: profile.cats || [],
      walkSchedule: null,
      preferredDuration: null,
      handoffDone: false,
      bookings: [],
      createdAt: new Date().toISOString(),
      // Supabase Auth handles email verification, so treat as verified by
      // the time the client row exists (signInWithPassword would've failed
      // for unconfirmed email/password users).
      emailVerified: true,
    };

    // Persist directly via REST so we can set user_id on the row itself
    // (our JSON blob lives in `data`, but user_id is a real column).
    try {
      const { invoices: _inv, ...rest } = newClient;
      await sbFetch("clients?on_conflict=pin", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{
          pin: pinKey,
          email,
          user_id: userId,
          data: JSON.stringify(rest),
        }]),
      });
    } catch (e) {
      console.error("saveClient (auth) failed:", e);
    }

    const updated = { ...clients, [pinKey]: newClient };
    setClients(updated);
    // Notify admins of new client — welcome email fires later, after M&G is booked
    const pets = [...(newClient.dogs || []), ...(newClient.cats || [])].join(", ");
    notifyAdmin("new_client", { name: newClient.name, email: newClient.email, pets });

    // Route into the portal
    setPendingRegistration(null);
    setSelectedRole("customer");
    setShowApp(true);
    setActiveUser(newClient);
  };

  const handleHandoffComplete = async (handoffData) => {
    // Resolve the PIN map key consistently — map is keyed by PIN, not by id
    const pinKey = activeUser.pin
      || Object.keys(clients).find(k => clients[k]?.id === activeUser.id)
      || Object.keys(clients).find(k => clients[k]?.user_id === activeUser.user_id)
      || activeUser.id;
    const client = clients[pinKey] || activeUser;
    let bookings = client.bookings || [];
    let followOnBooking = null;
    if (handoffData.followOnWalk) {
      const fw = handoffData.followOnWalk;
      const apptDate = new Date(fw.date);
      apptDate.setHours(fw.hour, fw.minute, 0, 0);
      const pet = (client.dogs || client.pets || [])[0] || (client.cats || [])[0] || "";
      followOnBooking = {
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
        price: Math.round(getSessionPrice(fw.duration) * 0.8),
        priceBeforeSameDayDiscount: getSessionPrice(fw.duration),
        sameDayDiscount: true,
        isFirstWalk: true, status: "pending_payment",
      };
      bookings = [...bookings, followOnBooking];
    }
    const updated = {
      ...client, handoffDone: true, handoffConfirmed: false, handoffInfo: handoffData, bookings,
      // Ensure the pin stays attached so the map key resolves on reload
      pin: pinKey,
      phone: handoffData.handoffPhone || client.phone || "",
      address: handoffData.handoffAddress || client.address || "",
      addrObj: handoffData.handoffAddrObj || client.addrObj || addrFromString(handoffData.handoffAddress || client.address || ""),
      preferredWalker: handoffData.handoffWalker || client.preferredWalker || "",
      keyholder: handoffData.handoffWalker || client.keyholder || "",
    };
    const updatedClients = { ...clients, [pinKey]: updated };
    setClients(updatedClients);
    try {
      await saveClients(updatedClients);
    } catch (err) {
      console.error("[handleHandoffComplete] saveClients failed:", err);
      alert("There was a problem saving your booking. Please try again — if this keeps happening, contact us at hello@lonestarbarkco.com");
      return;
    }
    setActiveUser(updated);

    // Send welcome email now that the M&G is booked — include appointment details
    sendWelcomeEmail({
      clientName: client.name || updated.name,
      clientEmail: client.email || updated.email,
      meetDate: handoffData.handoffDate
        ? new Date(handoffData.handoffDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
        : "",
      meetSlot: handoffData.handoffSlot?.label || handoffData.handoffSlot?.time || "",
      meetWalker: handoffData.handoffWalker || "",
    });

    // If the client added a follow-on walk, redirect to Stripe immediately.
    // The booking is already saved as pending_payment — on success the webhook
    // marks it confirmed; on cancel the booking_cancelled handler removes it.
    if (followOnBooking) {
      try {
        try {
          localStorage.setItem("dwi_stripe_return_clientId", pinKey);
          localStorage.setItem("dwi_pending_booking_keys", JSON.stringify([followOnBooking.key]));
        } catch {}
        const { url } = await createBookingCheckout({
          clientId: pinKey,
          clientName: updated.name,
          clientEmail: updated.email,
          bookingKey: followOnBooking.key,
          service: followOnBooking.service,
          date: followOnBooking.date,
          day: followOnBooking.day,
          time: followOnBooking.slot.time,
          duration: followOnBooking.slot.duration,
          walker: followOnBooking.form.walker,
          pet: followOnBooking.form.pet,
          amount: followOnBooking.price,
        });
        window.location.href = url;
      } catch (err) {
        console.error("[handleHandoffComplete] Stripe redirect failed:", err);
        // Fall through — client lands in dashboard with the pending_payment badge
        // so they can retry payment from My Walks
      }
    }
  };

  const handleSetClients = (updated) => {
    setClients(updated);
    if (activeUser && activeUser.role !== "walker" && activeUser.role !== "admin") {
      // Clients are keyed by PIN — resolve the correct key
      const pin = activeUser.pin
        || Object.keys(updated).find(k => updated[k]?.id === activeUser.id);
      if (pin && updated[pin]) setActiveUser(updated[pin]);
    }
  };

  // ── Global logout ─────────────────────────────────────────────────────────
  const handleLogout = () => {
    // Sign out of Supabase Auth (clients) — no-op for staff sessions
    authSignOut();
    setActiveUser(null);
    setSelectedRole(null);
    setShowApp(false);
    setAuthSession(null);
    setPendingRegistration(null);
    setRecoveryMode(false);
    // Returning visitors go straight back to the login/role screen
    const isReturning = (() => { try { return !!localStorage.getItem("dwi_has_visited"); } catch { return false; } })();
    setShowLogin(isReturning);
  };

  // ── Password recovery (user clicked reset link in email) ────────────────
  if (recoveryMode) return (
    <PasswordResetScreen onDone={() => {
      setRecoveryMode(false);
      setActiveUser(null);
      if (isAdminReset) {
        // Admin reset — route back to admin login screen
        setIsAdminReset(false);
        setSelectedRole("admin");
        setShowApp(true);
        setShowLogin(true);
      } else {
        // Client reset — route back to customer login
        setSelectedRole("customer");
        setShowApp(true);
        setShowLogin(true);
      }
    }} />
  );

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
        onRegister={handleRegister}
        onBack={() => { setSelectedRole(null); setShowApp(false); setShowLogin(true); }}
        onBackToLanding={() => { setSelectedRole(null); setShowApp(false); setShowLogin(false); }}
        pendingRegistration={pendingRegistration}
        clearPendingRegistration={() => setPendingRegistration(null)}
      />
    </CustomerErrorBoundary>
  );
  if (!activeUser.handoffDone) return (
    <CustomerErrorBoundary>
      <HandoffFlow client={activeUser} onComplete={handleHandoffComplete} onLogout={handleLogout} walkerProfiles={walkerProfiles} />
    </CustomerErrorBoundary>
  );
  return (
    <CustomerErrorBoundary>
      <BookingApp
        client={(() => {
          const pin = activeUser.pin || Object.keys(clients).find(k => clients[k]?.id === activeUser.id);
          return (pin && clients[pin]) || activeUser;
        })()}
        onLogout={handleLogout}
        clients={clients}
        setClients={handleSetClients}
        walkerProfiles={walkerProfiles}
      />
    </CustomerErrorBoundary>
  );
}
