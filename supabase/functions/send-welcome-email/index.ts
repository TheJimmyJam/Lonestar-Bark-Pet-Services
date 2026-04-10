// Supabase Edge Function: send-welcome-email
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
    const { clientName, clientEmail } = await req.json();
    const firstName = (clientName || "").split(" ")[0] || "there";

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Welcome to Lonestar Bark Co.</title></head>
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

        <!-- Body -->
        <tr><td style="padding:40px;">
          <h1 style="margin:0 0 10px;font-size:26px;color:#111827;font-weight:700;">Welcome, ${firstName}! 🎉</h1>
          <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.7;">
            You're officially part of the Lonestar Bark Co. family. We're a small, tight-knit team of dog walkers here in East Dallas — and we genuinely can't wait to meet your pup.
          </p>

          <!-- Next Steps box -->
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
            <tr><td style="background:#FDF5EC;border-radius:12px;border-left:4px solid #C4541A;padding:20px 24px;">
              <p style="margin:0 0 6px;color:#92400e;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">What's Next</p>
              <p style="margin:0;color:#7c3d12;font-size:15px;line-height:1.7;">
                Your first step is a free <strong>15-minute meet &amp; greet</strong> — your walker will come to you, meet your dog, and get familiar with your home. No pressure, just introductions.
              </p>
            </td></tr>
          </table>

          <!-- CTA Button -->
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td align="center" style="padding-bottom:32px;">
              <a href="https://lonestarbarkco.com" style="display:inline-block;padding:14px 36px;background:#C4541A;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                Log In &amp; Book Your Meet &amp; Greet →
              </a>
            </td></tr>
          </table>

          <!-- Trust line -->
          <p style="margin:0;color:#9ca3af;font-size:14px;line-height:1.6;text-align:center;">
            Questions before your first walk? Just reply to this email — we're real people and we actually respond.
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
        subject: `Welcome to Lonestar Bark Co., ${firstName}! 🐾`,
        html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-welcome-email error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
