import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://lonestarbarkco.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      clientId,
      clientName,
      clientEmail,
      bookingKey,
      service,
      date,
      day,
      time,
      duration,
      walker,
      pet,
      amount, // in dollars (e.g. 25.00)
    } = await req.json();

    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount" }), { status: 400, headers: corsHeaders });
    }

    const amountCents = Math.round(amount * 100);

    const walkerStr = walker ? ` with ${walker}` : "";
    const description = `Lonestar Bark Co. — ${service} on ${day}, ${date} at ${time}${walkerStr} (${pet})`;

    const successUrl = `${APP_URL}?payment=booking_success&session_id={CHECKOUT_SESSION_ID}&clientId=${encodeURIComponent(clientId)}&bookingKey=${encodeURIComponent(bookingKey)}`;
    const cancelUrl  = `${APP_URL}?payment=booking_cancelled&clientId=${encodeURIComponent(clientId)}&bookingKey=${encodeURIComponent(bookingKey)}`;

    const params = new URLSearchParams();
    params.append("payment_method_types[]", "card");
    params.append("mode", "payment");
    params.append("customer_email", clientEmail || "");
    params.append("line_items[0][price_data][currency]", "usd");
    params.append("line_items[0][price_data][unit_amount]", String(amountCents));
    params.append("line_items[0][price_data][product_data][name]", "Lonestar Bark Co.");
    params.append("line_items[0][price_data][product_data][description]", description);
    params.append("line_items[0][quantity]", "1");
    params.append("metadata[clientId]", String(clientId));
    params.append("metadata[bookingKey]", bookingKey);
    params.append("metadata[clientName]", clientName || "");
    params.append("metadata[clientEmail]", clientEmail || "");
    params.append("metadata[service]", service || "");
    params.append("metadata[date]", date || "");
    params.append("metadata[day]", day || "");
    params.append("metadata[time]", time || "");
    params.append("metadata[duration]", duration || "");
    params.append("metadata[walker]", walker || "");
    params.append("metadata[pet]", pet || "");
    params.append("metadata[amount]", String(amount || 0));
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await res.json();

    if (!res.ok) {
      console.error("Stripe error:", session);
      return new Response(JSON.stringify({ error: session?.error?.message || "Stripe error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-booking-checkout error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
