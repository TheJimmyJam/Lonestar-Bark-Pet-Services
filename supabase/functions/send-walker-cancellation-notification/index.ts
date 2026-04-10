import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SERVICE_MAP: Record<string, { label: string; emoji: string }> = {
  "30-min-walk":    { label: "30-Minute Walk",    emoji: "🐾" },
  "60-min-walk":    { label: "60-Minute Walk",    emoji: "🐾" },
  "drop-in":        { label: "Drop-In Visit",     emoji: "🏠" },
  "puppy-care":     { label: "Puppy Care",        emoji: "🐶" },
  "overnight-stay": { label: "Overnight Stay",    emoji: "🌙" },
  "meet-greet":     { label: "Meet & Greet",      emoji: "🤝" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { walkerName, walkerEmail, clientName, pet, service, date, day, time, duration } = await req.json();

    if (!walkerEmail) {
      return new Response(JSON.stringify({ error: "No walker email provided" }), { status: 400 });
    }

    const svc = SERVICE_MAP[service] || { label: service || "Service", emoji: "🐾" };
    const subject = `❌ Cancellation — ${clientName}'s ${pet || "booking"} on ${day}, ${date}`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#0B1423;padding:28px 32px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">
              🐾 Lonestar Bark Co.
            </p>
            <p style="margin:6px 0 0;font-size:13px;color:#9B7444;letter-spacing:1px;text-transform:uppercase;">
              Booking Cancellation
            </p>
          </td>
        </tr>

        <!-- Banner -->
        <tr>
          <td style="background:#dc2626;padding:14px 32px;text-align:center;">
            <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;">
              ❌ A booking has been cancelled
            </p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:28px 32px 8px;">
            <p style="margin:0;font-size:16px;color:#1a1a1a;">
              Hey ${walkerName || "there"},
            </p>
            <p style="margin:12px 0 0;font-size:15px;color:#444444;line-height:1.6;">
              The following booking has been cancelled and removed from your schedule:
            </p>
          </td>
        </tr>

        <!-- Booking Card -->
        <tr>
          <td style="padding:16px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border-radius:8px;border:1px solid #fecaca;overflow:hidden;">
              <tr>
                <td style="padding:20px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="6">
                    <tr>
                      <td style="font-size:13px;color:#888;width:120px;padding:5px 0;">Client</td>
                      <td style="font-size:14px;color:#1a1a1a;font-weight:600;padding:5px 0;">${clientName}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#888;padding:5px 0;">Pet</td>
                      <td style="font-size:14px;color:#1a1a1a;font-weight:600;padding:5px 0;">${pet || "—"}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#888;padding:5px 0;">Service</td>
                      <td style="font-size:14px;color:#1a1a1a;font-weight:600;padding:5px 0;">${svc.label}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#888;padding:5px 0;">Date</td>
                      <td style="font-size:14px;color:#1a1a1a;font-weight:600;padding:5px 0;">${day || ""}, ${date || "—"}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#888;padding:5px 0;">Time</td>
                      <td style="font-size:14px;color:#1a1a1a;font-weight:600;padding:5px 0;">${time || "—"}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#888;padding:5px 0;">Duration</td>
                      <td style="font-size:14px;color:#1a1a1a;font-weight:600;padding:5px 0;">${duration || "—"}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer note -->
        <tr>
          <td style="padding:8px 32px 32px;">
            <p style="margin:0;font-size:13px;color:#888888;line-height:1.6;">
              Your schedule has been updated. If you have any questions, reach out to the team.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0B1423;padding:20px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9B7444;">
              © ${new Date().getFullYear()} Lonestar Bark Co. · Dallas, TX
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
      body: JSON.stringify({ from: "Lonestar Bark Co. <hello@lonestarbarkco.com>", to: walkerEmail, subject, html }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
