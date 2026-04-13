import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Retrieves card last4 and brand from a completed Stripe Checkout session.
// Called by the client app after a successful payment redirect to populate
// the payment success banner with card details.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { sessionId } = await req.json();
    if (!sessionId) throw new Error("sessionId is required");

    if (!STRIPE_SECRET_KEY) throw new Error("Stripe key not configured");

    // Retrieve the checkout session, expanding payment_intent → payment_method
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=payment_intent.payment_method`,
      {
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        },
      }
    );

    if (!stripeRes.ok) {
      const errText = await stripeRes.text();
      throw new Error(`Stripe API error: ${errText}`);
    }

    const session = await stripeRes.json();

    // Dig out the card details
    const pm = session?.payment_intent?.payment_method;
    const card = pm?.card;

    if (!card) {
      // Session exists but card data isn't available (e.g. non-card payment method)
      return new Response(JSON.stringify({ last4: null, brand: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        last4: card.last4 || null,
        brand: card.brand || null,       // "visa", "mastercard", "amex", etc.
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[get-payment-details]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
