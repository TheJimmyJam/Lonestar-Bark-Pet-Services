import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY    = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY")!;
const EMAIL_1              = Deno.env.get("ADMIN_NOTIFY_EMAIL_1")!;
const EMAIL_2              = Deno.env.get("ADMIN_NOTIFY_EMAIL_2");

const FROM = "Lonestar Bark Co. <hello@send.lonestarbarkco.com>";

// ── Stripe signature verification ─────────────────────────────────────────────

async function verifyStripeSignature(
  body: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  if (!sigHeader || !secret) return false;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of sigHeader.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") timestamp = v;
    if (k === "v1") signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;

  // Reject events older than 5 minutes (replay attack protection)
  const ts = parseInt(timestamp, 10);
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    console.error("Stripe webhook timestamp too old:", ts);
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const rawSig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${body}`),
  );
  const computed = Array.from(new Uint8Array(rawSig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return signatures.some((s) => s === computed);
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  const body = await res.json();
  console.log(`[sendEmail] to=${to} status=${res.status}`, JSON.stringify(body));
  return body;
}

async function fetchStripeReceiptUrl(paymentIntentId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/charges?payment_intent=${paymentIntentId}&limit=1`,
      { headers: { Authorization: `Basic ${btoa(STRIPE_SECRET_KEY + ":")}` } },
    );
    const data = await res.json();
    const url = data?.data?.[0]?.receipt_url || "";
    console.log("[fetchStripeReceiptUrl] receipt_url:", url || "(none)");
    return url;
  } catch (e) {
    console.error("[fetchStripeReceiptUrl] failed:", String(e));
    return "";
  }
}

function bookingClientHtml(
  firstName: string,
  service: string,
  day: string,
  date: string,
  time: string,
  duration: string,
  walker: string,
  pet: string,
  amountPaid: string,
  receiptUrl: string,
) {
  const serviceLabel: Record<string, string> = { dog: "Dog Walk", cat: "Cat Visit", overnight: "Overnight Stay" };
  const serviceEmoji: Record<string, string> = { dog: "🐕", cat: "🐈", overnight: "🌙" };
  const displayService = serviceLabel[service] || service;
  const emoji = serviceEmoji[service] || "🐾";
  const walkerLine = walker
    ? `<tr><td style="color:#6b7280;font-size:14px;padding:6px 0;border-bottom:1px solid #f3f4f6;">Walker</td><td style="color:#111827;font-size:14px;font-weight:600;padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${walker}</td></tr>`
    : "";
  const petLine = pet
    ? `<tr><td style="color:#6b7280;font-size:14px;padding:6px 0;border-bottom:1px solid #f3f4f6;">Pet</td><td style="color:#111827;font-size:14px;font-weight:600;padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${pet}</td></tr>`
    : "";

  return `<!DOCTYPE html>
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
          <div style="color:#9B7444;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin-top:6px;">Dallas Dog Walking</div>
        </td></tr>

        <!-- Confirmed + Paid banner -->
        <tr><td style="background:#059669;padding:16px 40px;text-align:center;">
          <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">✓ Booking Confirmed &amp; Payment Received</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px;">
          <h1 style="margin:0 0 6px;font-size:24px;color:#111827;font-weight:700;">You're all set, ${firstName}!</h1>
          <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.7;">
            Here are your booking details and payment receipt.
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
              </table>
            </td></tr>
          </table>

          <!-- Payment receipt card -->
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;border:1.5px solid #d1fae5;border-radius:12px;overflow:hidden;background:#f0fdf4;">
            <tr><td style="padding:20px 24px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="color:#065f46;font-size:14px;padding:4px 0;">Amount Paid</td>
                  <td style="color:#059669;font-size:22px;font-weight:700;text-align:right;">$${amountPaid}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding-top:6px;">Status</td>
                  <td style="color:#374151;font-size:13px;font-weight:600;text-align:right;padding-top:6px;">Paid ✓</td>
                </tr>
              </table>
              ${receiptUrl ? `
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;">
                <tr><td align="center">
                  <a href="${receiptUrl}" style="display:inline-block;padding:10px 24px;background:#059669;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
                    View Stripe Receipt →
                  </a>
                </td></tr>
              </table>` : ""}
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
            Keep this email as your receipt. See you on the walk! 🐕
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e4e7ec;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:13px;">
            <a href="mailto:hello@lonestarbarkco.com" style="color:#C4541A;text-decoration:none;">hello@lonestarbarkco.com</a>
          </p>
          <p style="margin:6px 0 0;color:#d1d5db;font-size:12px;">Lonestar Bark Co. · Dallas, TX</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── main ──────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const body = await req.text();
  console.log("Webhook received, body length:", body.length);

  // ── Verify Stripe signature ────────────────────────────────────────────────
  const sigHeader = req.headers.get("stripe-signature") || "";
  const isValid = await verifyStripeSignature(body, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    console.error("Invalid Stripe webhook signature — rejected");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const event = JSON.parse(body);
    console.log("Event type:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const meta = session.metadata || {};

      const invoiceId   = meta.invoiceId;
      const bookingKey  = meta.bookingKey;
      const clientName  = meta.clientName || "";
      const clientEmail = meta.clientEmail || session.customer_email || "";
      const amountPaid  = (session.amount_total / 100).toFixed(2);
      const firstName   = clientName.split(" ")[0] || "there";
      const paidAt      = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });

      console.log("Payment completed — invoiceId:", invoiceId, "bookingKey:", bookingKey, "client:", clientName, "amount:", amountPaid);

      const adminRecipients = [EMAIL_1, ...(EMAIL_2 ? [EMAIL_2] : [])];

      // ── BOOKING payment ───────────────────────────────────────────────────
      if (bookingKey) {
        const service  = meta.service  || "";
        const date     = meta.date     || "";
        const day      = meta.day      || "";
        const time     = meta.time     || "";
        const duration = meta.duration || "";
        const walker   = meta.walker   || "";
        const pet      = meta.pet      || "";

        // 1. Client confirmation + receipt email
        if (clientEmail) {
          const serviceLabel: Record<string, string> = { dog: "Dog Walk", cat: "Cat Visit", overnight: "Overnight Stay" };
          const serviceEmoji: Record<string, string> = { dog: "🐕", cat: "🐈", overnight: "🌙" };
          const displayService = serviceLabel[service] || service || "Service";
          const emoji = serviceEmoji[service] || "🐾";

          const receiptUrl = session.payment_intent
            ? await fetchStripeReceiptUrl(session.payment_intent)
            : "";

          await sendEmail(
            clientEmail,
            `${emoji} Booking Confirmed — ${day}, ${date} at ${time}`,
            bookingClientHtml(firstName, service, day, date, time, duration, walker, pet, amountPaid, receiptUrl),
          );
        }

        // 2. Admin notification
        if (EMAIL_1) {
          const adminServiceLabels: Record<string, string> = {
            dog: "Dog Walk",
            cat: "Cat Visit",
            overnight: "Overnight Stay",
          };
          const adminDisplayService = adminServiceLabels[service] || service || "Service";
          const adminHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>New Booking!</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#0B1423;padding:26px 40px;text-align:center;">
          <div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">Lonestar Bark Co.</div>
          <div style="color:#9B7444;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-top:6px;">Admin Alert</div>
        </td></tr>

        <!-- Hero -->
        <tr><td style="background:#C4541A;padding:22px 40px;text-align:center;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">
            🦴 Hooray — New Booking!
          </p>
        </td></tr>

        <!-- Paid banner -->
        <tr><td style="background:#059669;padding:12px 40px;text-align:center;">
          <p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.5px;">✓ PAYMENT RECEIVED — $${amountPaid}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:34px 40px 12px;">
          <p style="margin:0 0 22px;color:#111827;font-size:16px;line-height:1.6;font-weight:600;">
            Think of all the milkbones we can buy. 🦴
          </p>

          <!-- Details card -->
          <table cellpadding="0" cellspacing="0" width="100%" style="background:#FDF5EC;border-radius:12px;border-left:4px solid #C4541A;margin-bottom:28px;">
            <tr><td style="padding:22px 26px;">
              <table cellpadding="6" cellspacing="0" width="100%" style="border-collapse:collapse;">
                <tr>
                  <td style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;width:110px;vertical-align:top;padding-top:3px;">Client</td>
                  <td style="color:#111827;font-size:15px;line-height:1.5;">${clientName}</td>
                </tr>
                <tr>
                  <td style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;vertical-align:top;padding-top:3px;">Pet</td>
                  <td style="color:#111827;font-size:15px;line-height:1.5;">${pet || "—"}</td>
                </tr>
                <tr>
                  <td style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;vertical-align:top;padding-top:3px;">Service</td>
                  <td style="color:#111827;font-size:15px;line-height:1.5;">${adminDisplayService}</td>
                </tr>
                <tr>
                  <td style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;vertical-align:top;padding-top:3px;">Date</td>
                  <td style="color:#111827;font-size:15px;line-height:1.5;">${day}, ${date}</td>
                </tr>
                <tr>
                  <td style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;vertical-align:top;padding-top:3px;">Time</td>
                  <td style="color:#111827;font-size:15px;line-height:1.5;">${time}${duration ? ` (${duration})` : ""}</td>
                </tr>
                <tr>
                  <td style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;vertical-align:top;padding-top:3px;">Walker</td>
                  <td style="color:#111827;font-size:15px;line-height:1.5;">${walker || "Unassigned"}</td>
                </tr>
                <tr>
                  <td style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;vertical-align:top;padding-top:3px;">Amount</td>
                  <td style="color:#059669;font-size:16px;font-weight:700;line-height:1.5;">$${amountPaid}</td>
                </tr>
                <tr>
                  <td style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;vertical-align:top;padding-top:3px;">Paid At</td>
                  <td style="color:#4b5563;font-size:14px;line-height:1.5;">${paidAt} CT</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td align="center" style="padding-bottom:22px;">
              <a href="https://lonestarbarkco.com" style="display:inline-block;padding:14px 38px;background:#C4541A;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                Open Admin Dashboard →
              </a>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e4e7ec;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">Lonestar Bark Co. · Dallas, TX</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
          for (const to of adminRecipients) {
            await sendEmail(to, `🦴 Hooray — New Booking: ${clientName}`, adminHtml);
          }
        }
      }

      // ── INVOICE payment ───────────────────────────────────────────────────
      if (invoiceId) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // Idempotency guard — skip if already paid to prevent duplicate emails
        const { data: existingInv } = await supabase
          .from("invoices")
          .select("status")
          .eq("id", invoiceId)
          .single();

        if (existingInv?.status === "paid") {
          console.log("Invoice already paid, skipping duplicate webhook:", invoiceId);
          return new Response(JSON.stringify({ received: true, skipped: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Update invoice status in Supabase
        const { error } = await supabase
          .from("invoices")
          .update({ status: "paid", paid_at: new Date().toISOString() })
          .eq("id", invoiceId);

        if (error) {
          console.error("Invoice update error:", JSON.stringify(error));
        } else {
          console.log("Invoice marked paid:", invoiceId);
        }

        // Admin notification for invoice payment
        if (EMAIL_1) {
          for (const to of adminRecipients) {
          await sendEmail(
            to,
            `💳 Invoice Paid: ${clientName}`,
            `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
              <h2 style="color:#C4541A">Invoice Paid</h2>
              <p><strong>Client:</strong> ${clientName}</p>
              <p><strong>Invoice:</strong> ${invoiceId}</p>
              <p><strong>Amount:</strong> $${amountPaid}</p>
              <p><strong>Paid at:</strong> ${paidAt}</p>
            </div>`,
          );
          }
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Webhook error:", String(e));
    return new Response(JSON.stringify({ error: String(e) }), { status: 400 });
  }
});
