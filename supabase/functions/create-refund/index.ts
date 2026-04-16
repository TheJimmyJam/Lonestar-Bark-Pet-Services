import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const STRIPE_SECRET_KEY  = Deno.env.get("STRIPE_SECRET_KEY")  || "";
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")        || "";
const SUPABASE_ANON_KEY  = Deno.env.get("SUPABASE_ANON_KEY")  || "";
const SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Ownership check ───────────────────────────────────────────────────────────
// Verifies the Stripe checkout session was legitimately created by this app.
// Checks session metadata against live DB records so a caller who only has
// a Stripe session ID (but no matching DB record) is rejected.
//
// Booking sessions:  metadata.clientId  → clients table (pin column)
// Invoice sessions:  metadata.invoiceId → invoices table (id column)
async function isLegitimateSession(session: Record<string, unknown>): Promise<boolean> {
  const meta = (session?.metadata ?? {}) as Record<string, string>;
  const dbHeaders = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Booking checkout — clientId is the client's PIN
  if (meta.clientId) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?pin=eq.${encodeURIComponent(meta.clientId)}&select=pin&limit=1`,
      { headers: dbHeaders },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  }

  // Invoice checkout — invoiceId stored in invoices table
  if (meta.invoiceId) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?id=eq.${encodeURIComponent(meta.invoiceId)}&select=id&limit=1`,
      { headers: dbHeaders },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  }

  // No recognisable metadata — not from this app
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { stripeSessionId, reason, amount } = await req.json();
    // amount: optional dollar value for partial refund (e.g. 12.50); omit for full refund

    if (!stripeSessionId) {
      return new Response(JSON.stringify({ error: "stripeSessionId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retrieve the checkout session from Stripe
    const sessionRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${stripeSessionId}`,
      { headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` } },
    );
    const session = await sessionRes.json();

    if (!sessionRes.ok || !session.payment_intent) {
      return new Response(JSON.stringify({ error: "Could not find payment intent for session" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Ownership gate ────────────────────────────────────────────────────────
    // Reject the request if the Stripe session doesn't correspond to a real
    // client or invoice in the database. This blocks anyone who somehow
    // obtained a Stripe session ID from triggering an unauthorised refund.
    const legitimate = await isLegitimateSession(session);
    if (!legitimate) {
      console.warn("[create-refund] rejected — session metadata not found in DB:", stripeSessionId);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build refund params
    const refundParams = new URLSearchParams();
    refundParams.append("payment_intent", session.payment_intent as string);
    if (reason) refundParams.append("reason", reason);
    // Partial refund: convert dollars → cents
    if (amount !== undefined && amount !== null) {
      refundParams.append("amount", String(Math.round(amount * 100)));
    }

    const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: refundParams.toString(),
    });

    const refund = await refundRes.json();

    if (!refundRes.ok) {
      console.error("Stripe refund error:", refund);
      return new Response(JSON.stringify({ error: refund?.error?.message || "Refund failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retrieve the charge to get the hosted receipt URL (shows the refund)
    let receiptUrl: string | null = null;
    try {
      const piRes = await fetch(
        `https://api.stripe.com/v1/payment_intents/${session.payment_intent}?expand[]=latest_charge`,
        { headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` } },
      );
      const pi = await piRes.json();
      receiptUrl = pi?.latest_charge?.receipt_url ?? null;
    } catch (e) {
      console.error("Could not retrieve receipt_url:", e);
    }

    return new Response(
      JSON.stringify({ refundId: refund.id, status: refund.status, amount: refund.amount / 100, receiptUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("create-refund error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
