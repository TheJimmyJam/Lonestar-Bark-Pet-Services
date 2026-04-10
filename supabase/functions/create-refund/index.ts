import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { stripeSessionId, reason, amount } = await req.json();
    // amount: optional dollar amount for partial refund (e.g. 12.50)
    // omit for full refund

    if (!stripeSessionId) {
      return new Response(JSON.stringify({ error: "stripeSessionId required" }), {
        status: 400, headers: corsHeaders,
      });
    }

    // Retrieve the checkout session to get the payment intent
    const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${stripeSessionId}`, {
      headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const session = await sessionRes.json();

    if (!sessionRes.ok || !session.payment_intent) {
      return new Response(JSON.stringify({ error: "Could not find payment intent for session" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build refund params
    const refundParams = new URLSearchParams();
    refundParams.append("payment_intent", session.payment_intent);
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

    return new Response(JSON.stringify({ refundId: refund.id, status: refund.status, amount: refund.amount / 100 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-refund error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
