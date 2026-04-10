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
    const { name, email, code } = await req.json();
    const firstName = (name || "").split(" ")[0] || "there";

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#0B1423;padding:28px 40px;text-align:center;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">🐾 Lonestar Bark Co.</p>
          <p style="margin:6px 0 0;font-size:11px;color:#9B7444;letter-spacing:3px;text-transform:uppercase;">PIN Reset</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px 28px;">
          <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hey ${firstName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.7;">
            We got a request to reset your PIN. Use the code below — it expires in <strong>15 minutes</strong>.
          </p>

          <!-- Code box -->
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
            <tr><td align="center" style="background:#f8f4ef;border-radius:12px;border:2px dashed #C4541A;padding:28px 20px;">
              <p style="margin:0 0 8px;font-size:12px;color:#9B7444;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Your reset code</p>
              <p style="margin:0;font-size:42px;font-weight:700;color:#0B1423;letter-spacing:10px;">${code}</p>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;line-height:1.6;">
            Enter this code on the login screen when prompted, then set a new 6-digit PIN.
          </p>
          <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
            Didn't request a reset? You can safely ignore this email — your PIN hasn't changed.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e4e7ec;text-align:center;">
          <p style="margin:0;font-size:13px;color:#9ca3af;">
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
        to: [email],
        subject: `Your Lonestar Bark Co. PIN reset code: ${code}`,
        html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-pin-reset-code error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
