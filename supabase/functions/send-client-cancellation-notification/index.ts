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
  "dog":            { label: "Dog Walk",           emoji: "🐕" },
  "cat":            { label: "Cat Visit",          emoji: "🐈" },
  "overnight":      { label: "Overnight Stay",    emoji: "🌙" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      clientName, clientEmail, pet, service, date, day, time, duration, walker,
      refundAmount, refundPercent, isStripeRefund, refundId, receiptUrl, bookingPrice,
    } = await req.json();

    if (!clientEmail) {
      return new Response(JSON.stringify({ error: "No client email provided" }), { status: 400 });
    }

    const firstName = (clientName || "").split(" ")[0] || "there";
    const svc = SERVICE_MAP[service] || { label: service || "Service", emoji: "🐾" };

    const hasRefund = refundAmount && refundAmount > 0;
    const refundLabel = hasRefund
      ? `$${Number(refundAmount).toFixed(2)}`
      : null;
    const refundPct = refundPercent != null ? Math.round(refundPercent * 100) : 0;

    const subject = hasRefund
      ? `Your Lonestar Bark appointment has been cancelled — refund of ${refundLabel} is on the way`
      : `Your Lonestar Bark appointment has been cancelled`;

    const walkerRow = walker
      ? `<tr>
           <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #f3f4f6;width:110px;">Walker</td>
           <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${walker}</td>
         </tr>`
      : "";

    const petRow = pet
      ? `<tr>
           <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #f3f4f6;">Pet</td>
           <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${pet}</td>
         </tr>`
      : "";

    const durationRow = duration
      ? `<tr>
           <td style="font-size:13px;color:#6b7280;padding:8px 0;">Duration</td>
           <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;text-align:right;">${duration}</td>
         </tr>`
      : "";

    // Refund reference row — only shown when Stripe confirmed the refund
    const refundIdRow = isStripeRefund && refundId
      ? `<tr>
           <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #dcfce7;">Reference #</td>
           <td style="font-size:12px;color:#374151;font-weight:500;padding:8px 0;border-bottom:1px solid #dcfce7;text-align:right;font-family:monospace;">${refundId}</td>
         </tr>`
      : "";

    // Refund block — shown for all paid bookings
    const refundBlock = hasRefund ? `
        <!-- Refund Receipt Card -->
        <tr>
          <td style="padding:0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0;overflow:hidden;">
              <tr>
                <td style="padding:18px 24px 4px;" colspan="2">
                  <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#16a34a;">
                    ${isStripeRefund ? "✅ Refund Processed" : "💰 Refund Owed"}
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:0 24px 16px;" colspan="2">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #dcfce7;width:140px;">Refund Amount</td>
                      <td style="font-size:22px;color:#15803d;font-weight:700;padding:8px 0;border-bottom:1px solid #dcfce7;text-align:right;">${refundLabel}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #dcfce7;">Cancellation Policy</td>
                      <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #dcfce7;text-align:right;">${refundPct}% refund applied</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #dcfce7;">Original Charge</td>
                      <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #dcfce7;text-align:right;">$${Number(bookingPrice || 0).toFixed(2)}</td>
                    </tr>
                    ${refundIdRow}
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;">Processing Time</td>
                      <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;text-align:right;">${isStripeRefund ? "5–10 business days" : "We'll be in touch shortly"}</td>
                    </tr>
                  </table>
                  <p style="margin:12px 0 0;font-size:12px;color:#6b7280;line-height:1.6;">
                    ${isStripeRefund
                      ? "Your refund has been submitted to your original payment method. Processing time depends on your card issuer. Keep this email as your receipt."
                      : "Reply to this email and we'll arrange your refund right away. We're sorry for any inconvenience."}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : bookingPrice > 0 ? `
        <!-- No Refund Note (paid booking, cancelled too late) -->
        <tr>
          <td style="padding:0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#fffbeb;border-radius:12px;border:1px solid #fde68a;overflow:hidden;">
              <tr>
                <td style="padding:16px 24px;">
                  <div style="font-size:13px;color:#92400e;line-height:1.6;">
                    <strong>No refund applies</strong> to this cancellation per our cancellation policy
                    (cancellations within 12 hours of the scheduled walk are non-refundable).
                    If you have questions, reply to this email and we'll be happy to help.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ``;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Appointment Cancelled</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#0B1423;padding:36px 40px;text-align:center;">
            <div style="font-size:36px;margin-bottom:10px;">🐾</div>
            <div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Lonestar Bark Co.</div>
            <div style="color:#9B7444;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin-top:6px;">East Dallas Dog Walking</div>
          </td>
        </tr>

        <!-- Cancellation Banner -->
        <tr>
          <td style="background:#fef2f2;border-top:4px solid #dc2626;padding:20px 40px;text-align:center;">
            <div style="font-size:28px;margin-bottom:8px;">❌</div>
            <div style="font-size:18px;font-weight:700;color:#991b1b;letter-spacing:0.3px;">Appointment Cancelled</div>
            <div style="font-size:13px;color:#b91c1c;margin-top:4px;">Your booking has been removed from the schedule.</div>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:32px 40px 16px;">
            <p style="margin:0;font-size:16px;color:#111827;font-weight:600;">Hi ${firstName},</p>
            <p style="margin:14px 0 0;font-size:15px;color:#4b5563;line-height:1.7;">
              We're confirming that your upcoming appointment with Lonestar Bark Co. has been successfully cancelled.
              ${hasRefund && isStripeRefund
                ? ` A refund of <strong style="color:#15803d;">${refundLabel}</strong> has been submitted to your original payment method.`
                : hasRefund
                ? ` You are owed a refund of <strong style="color:#15803d;">${refundLabel}</strong> — please reply to this email and we'll take care of it right away.`
                : ""}
            </p>
          </td>
        </tr>

        <!-- Booking Details Card -->
        <tr>
          <td style="padding:0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#fafafa;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
              <tr>
                <td style="padding:18px 24px 4px;" colspan="2">
                  <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;">
                    Cancelled Appointment
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:0 24px 16px;" colspan="2">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #f3f4f6;width:110px;">Service</td>
                      <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${svc.emoji} ${svc.label}</td>
                    </tr>
                    ${petRow}
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #f3f4f6;">Date</td>
                      <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${day || ""} ${date || "—"}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #f3f4f6;">Time</td>
                      <td style="font-size:14px;color:#111827;font-weight:600;padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${time || "—"}</td>
                    </tr>
                    ${durationRow}
                    ${walkerRow}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${refundBlock}

        ${isStripeRefund && receiptUrl ? `
        <!-- Stripe Receipt CTA -->
        <tr>
          <td style="padding:0 40px 24px;text-align:center;">
            <a href="${receiptUrl}"
              style="display:inline-block;background:#0B1423;color:#ffffff;font-size:14px;font-weight:700;
                     text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.5px;">
              View Stripe Receipt →
            </a>
            <p style="margin:10px 0 0;font-size:12px;color:#9ca3af;">
              Your receipt will show the refund once it has been processed by Stripe.
            </p>
          </td>
        </tr>` : ""}

        <!-- Rebook CTA -->
        <tr>
          <td style="padding:0 40px 32px;text-align:center;">
            <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.7;">
              Want to schedule a new appointment? Log in to your account and book at any time —
              we'd love to see ${pet ? pet : "your pup"} again soon. 🐶
            </p>
            <a href="https://lonestarbarkco.com"
              style="display:inline-block;background:#9B7444;color:#ffffff;font-size:14px;font-weight:700;
                     text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.5px;">
              Book Again
            </a>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 40px;">
            <div style="border-top:1px solid #f3f4f6;"></div>
          </td>
        </tr>

        <!-- Support Note -->
        <tr>
          <td style="padding:24px 40px;">
            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.7;text-align:center;">
              Questions? Reply to this email or reach us at
              <a href="mailto:hello@lonestarbarkco.com" style="color:#9B7444;text-decoration:none;">hello@lonestarbarkco.com</a>.<br>
              We're always happy to help.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0B1423;padding:20px 40px;text-align:center;border-radius:0 0 16px 16px;">
            <p style="margin:0;font-size:12px;color:#9B7444;letter-spacing:1px;">
              © ${new Date().getFullYear()} Lonestar Bark Co. · Dallas, TX
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:#4b5563;">
              You're receiving this because you have an account with Lonestar Bark Co.
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
        from: "Lonestar Bark Co. <hello@send.lonestarbarkco.com>",
        to: clientEmail,
        subject,
        html,
      }),
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
