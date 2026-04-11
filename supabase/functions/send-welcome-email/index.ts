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
    const { clientName, clientEmail, meetDate, meetSlot, meetWalker } = await req.json();
    const firstName = (clientName || "").split(" ")[0] || "there";

    const walkerRow = meetWalker
      ? `<tr>
           <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #f3f4f6;width:110px;">Your Walker</td>
           <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${meetWalker}</td>
         </tr>`
      : "";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Welcome to Lonestar Bark Co.</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#0B1423;padding:32px 40px;text-align:center;">
            <img src="${LOGO_URL}" alt="Lonestar Bark Co." width="160"
              style="display:block;margin:0 auto;max-width:160px;height:auto;border-radius:8px;" />
            <div style="color:#9B7444;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-top:14px;">
              East Dallas Dog Walking
            </div>
          </td>
        </tr>

        <!-- Welcome Banner -->
        <tr>
          <td style="background:#C4541A;padding:22px 40px;text-align:center;">
            <p style="margin:0;font-size:21px;font-weight:700;color:#ffffff;line-height:1.3;">
              Welcome to the Pack, ${firstName}.
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 28px;">
            <p style="margin:0 0 18px;color:#111827;font-size:16px;line-height:1.7;">
              Hi ${firstName} — you're officially on the books. We're glad you found us.
            </p>
            <p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.8;">
              We're a small team of dog people based in East Dallas. We keep our client list intentional
              so every dog gets the attention they deserve — not just a walk, but someone who actually
              knows them. You'll always know who's coming to your door.
            </p>

            <!-- M&G Appointment Card -->
            <table cellpadding="0" cellspacing="0" width="100%"
              style="background:#fafafa;border-radius:12px;border:1px solid #e5e7eb;margin:0 0 28px;overflow:hidden;">
              <tr>
                <td style="padding:18px 24px 4px;" colspan="2">
                  <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;">
                    Your Meet &amp; Greet
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:0 24px 16px;" colspan="2">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #f3f4f6;width:110px;">Date</td>
                      <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">
                        ${meetDate || "Appointment scheduled"}
                      </td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #f3f4f6;">Window</td>
                      <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">
                        ${meetSlot || "—"}
                      </td>
                    </tr>
                    ${walkerRow}
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;">Duration</td>
                      <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;text-align:right;">~15 minutes</td>
                    </tr>
                  </table>
                  <p style="margin:14px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
                    Your walker will come to you — no need to go anywhere.
                    They'll get to know your dog, go over your routine, and grab a key if you're comfortable leaving one.
                    We'll reach out closer to the date to confirm the exact arrival time within that window.
                  </p>
                </td>
              </tr>
            </table>

            <!-- What to expect -->
            <p style="margin:0 0 12px;color:#111827;font-size:15px;font-weight:600;">
              A couple of things worth knowing:
            </p>
            <p style="margin:0 0 10px;color:#4b5563;font-size:15px;line-height:1.8;">
              <strong style="color:#374151;">We're flexible.</strong>
              Need to reschedule or adjust? Just reach out. Life happens, we get it.
            </p>
            <p style="margin:0 0 10px;color:#4b5563;font-size:15px;line-height:1.8;">
              <strong style="color:#374151;">You're in control.</strong>
              Log in any time to book walks, check your schedule, or update your info.
            </p>
            <p style="margin:0 28px 0;color:#4b5563;font-size:15px;line-height:1.8;">
              <strong style="color:#374151;">Questions?</strong>
              Reply to this email. We read every one.
            </p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:0 40px 36px;text-align:center;">
            <a href="https://lonestarbarkco.com"
              style="display:inline-block;padding:14px 36px;background:#C4541A;color:#ffffff;
                     font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
              Log In to Your Account →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e4e7ec;text-align:center;">
            <p style="margin:0;color:#9ca3af;font-size:13px;">
              <a href="mailto:hello@lonestarbarkco.com" style="color:#C4541A;text-decoration:none;">
                hello@lonestarbarkco.com
              </a>
            </p>
            <p style="margin:6px 0 0;color:#d1d5db;font-size:12px;">
              Lonestar Bark Co. · East Dallas, TX
            </p>
          </td>
        </tr>

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
        from: "Lonestar Bark <hello@send.lonestarbarkco.com>",
        to: [clientEmail],
        subject: `Welcome to the Pack, ${firstName} — your Meet & Greet is confirmed`,
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
