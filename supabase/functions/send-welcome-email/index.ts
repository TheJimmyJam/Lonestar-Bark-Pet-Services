import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOGO_URL = "https://mvkmxmhsudqwxrsiifms.supabase.co/storage/v1/object/sign/assets/IMG_8716.jpeg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9hNjBhM2MyYS1lNmRjLTQ1YWYtODdlYS05Yjg3Y2FjNTAxZmIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJhc3NldHMvSU1HXzg3MTYuanBlZyIsImlhdCI6MTc3NTc5NzIzNSwiZXhwIjoxODA3MzMzMjM1fQ.ThJcfTliGcH6Vh_havhobfL6hU1Ih0QAkO1-DdFrijI";

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
<title>Welcome to the Pack</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header with logo -->
        <tr><td style="background:#0B1423;padding:32px 40px;text-align:center;">
          <img src="${LOGO_URL}" alt="Lonestar Bark Co." width="160" style="display:block;margin:0 auto;max-width:160px;height:auto;border-radius:8px;" />
          <div style="color:#9B7444;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-top:14px;">East Dallas Dog Walking</div>
        </td></tr>

        <!-- Hero -->
        <tr><td style="background:#C4541A;padding:22px 40px;text-align:center;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">
            🐾 Welcome to the Pack, ${firstName}!
          </p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px 20px;">
          <p style="margin:0 0 18px;color:#111827;font-size:16px;line-height:1.7;font-weight:600;">
            You're in. Your dog is already our favorite person.
          </p>
          <p style="margin:0 0 18px;color:#4b5563;font-size:15px;line-height:1.8;">
            We're Lonestar Bark Co. — a small crew of genuine dog people here in East Dallas.
            We take tail wags seriously, we know a zoomie from a bad day, and we treat every
            pup like they're our own.
          </p>
          <p style="margin:0 0 18px;color:#4b5563;font-size:15px;line-height:1.8;">
            (We're also pretty fond of you, ${firstName}. But let's be honest — we're really here for the dog.)
          </p>

          <!-- Meet & Greet box -->
          <table cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 28px;">
            <tr><td style="background:#FDF5EC;border-radius:12px;border-left:4px solid #C4541A;padding:20px 24px;">
              <p style="margin:0 0 8px;color:#92400e;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">🤝 First things first</p>
              <p style="margin:0;color:#7c3d12;font-size:15px;line-height:1.7;">
                Your next step is a free <strong>15-minute Meet &amp; Greet</strong>. Your walker comes to you,
                meets your pup on their turf, and gets the full rundown — quirks, routines, the whole nine yards.
                No pressure, no commitment. Just sniffs and handshakes.
              </p>
            </td></tr>
          </table>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td align="center" style="padding-bottom:28px;">
              <a href="https://lonestarbarkco.com" style="display:inline-block;padding:15px 40px;background:#C4541A;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                Book Your Meet &amp; Greet →
              </a>
            </td></tr>
          </table>

          <p style="margin:0;color:#9ca3af;font-size:14px;line-height:1.6;text-align:center;">
            Got questions? Just reply here — we're real humans, not a chatbot.<br/>
            (Well… we use one occasionally. But this email? All us.)
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
        subject: `Welcome to the Pack, ${firstName}! 🐾`,
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
