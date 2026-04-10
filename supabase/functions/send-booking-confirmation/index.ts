// Supabase Edge Function: send-booking-confirmation
// Deploy via Supabase Dashboard → Edge Functions → New Function
// Required secret: RESEND_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { clientName, clientEmail, service, date, day, time, duration, walker, price, pet } = await req.json();
    const firstName = (clientName || "").split(" ")[0] || "there";

    const serviceLabel: Record<string, string> = {
      dog: "Dog Walk",
      cat: "Cat Visit",
      overnight: "Overnight Stay",
    };
    const serviceEmoji: Record<string, string> = {
      dog: "🐕",
      cat: "🐈",
      overnight: "🌙",
    };

    const displayService = serviceLabel[service] || service;
    const emoji = serviceEmoji[service] || "🐾";
    const walkerLine = walker ? `<tr><td style="color:#6b7280;font-size:14px;padding:6px 0;border-bottom:1px solid #f3f4f6;">Walker</td><td style="color:#111827;font-size:14px;font-weight:600;padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${walker}</td></tr>` : "";
    const petLine = pet ? `<tr><td style="color:#6b7280;font-size:14px;padding:6px 0;border-bottom:1px solid #f3f4f6;">Pet</td><td style="color:#111827;font-size:14px;font-weight:600;padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${pet}</td></tr>` : "";

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Booking Confirmed</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#0B1423;padding:36px 40px;text-align:center;">
          <div style="font-size:36px;margin-bottom:10px;">🐾</div>
          <div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Lonestar Bark Co.</div>
          <div style="color:#9B7444;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin-top:6px;">East Dallas Dog Walking</div>
        </td></tr>

        <!-- Confirmed banner -->
        <tr><td style="background:#059669;padding:16px 40px;text-align:center;">
          <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">✓ Booking Confirmed</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px;">
          <h1 style="margin:0 0 6px;font-size:24px;color:#111827;font-weight:700;">You're all set, ${firstName}!</h1>
          <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.7;">
            Here are the details for your upcoming ${displayService.toLowerCase()}.
          </p>

          <!-- Booking card -->
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;border:1.5px solid #e4e7ec;border-radius:12px;overflow:hidden;">
            <tr><td style="background:#f9fafb;padding:16px 20px;">
              <p style="margin:0;font-size:18px;">${emoji} <strong style="color:#111827;">${displayService}</strong></p>
            </td></tr>
            <tr><td style="padding:0 20px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="color:#6b7280;font-size:14px;padding:10px 0 6px;border-bottom:1px solid #f3f4f6;">Date</td><td style="color:#111827;font-size:14px;font-weight:600;padding:10px 0 6px;border-bottom:1px solid #f3f4f6;text-align:right;">${day}, ${date}</td></tr>
                <tr><td style="color:#6b7280;font-size:14px;padding:6px 0;border-bottom:1px solid #f3f4f6;">Time</td><td style="color:#111827;font-size:14px;font-weight:600;padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${time}</td></tr>
                <tr><td style="color:#6b7280;font-size:14px;padding:6px 0;border-bottom:1px solid #f3f4f6;">Duration</td><td style="color:#111827;font-size:14px;font-weight:600;padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${duration}</td></tr>
                ${petLine}
                ${walkerLine}
                ${price ? `<tr><td style="color:#6b7280;font-size:14px;padding:6px 0;">Price</td><td style="color:#C4541A;font-size:15px;font-weight:700;padding:6px 0;text-align:right;">$${price}</td></tr>` : ""}
              </table>
            </td></tr>
          </table>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td align="center" style="padding-bottom:28px;">
              <a href="https://lonestarbarkco.com" style="display:inline-block;padding:13px 32px;background:#C4541A;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;">
                View in Portal →
              </a>
            </td></tr>
          </table>

          <p style="margin:0;color:#9ca3af;font-size:14px;line-height:1.6;text-align:center;">
            Need to reschedule? Log in to your portal or reply to this email.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e4e7ec;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:13px;">
            <a href="mailto:hello@lonestarbarkco.com" style="color:#C4541A;text-decoration:none;">hello@lonestarbarkco.com</a>
          </p>
          <p style="margin:6px 0 0;color:#d1d5db;font-size:12px;">Lonestar Bark Co. · East Dallas, TX</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Lonestar Bark Co. <hello@lonestarbarkco.com>",
        to: [clientEmail],
        subject: `${emoji} Booking Confirmed — ${day}, ${date} at ${time}`,
        html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-booking-confirmation error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
