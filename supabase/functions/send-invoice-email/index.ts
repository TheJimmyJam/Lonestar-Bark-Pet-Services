// Supabase Edge Function: send-invoice-email
// Deploy via: supabase functions deploy send-invoice-email
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
    const { clientName, clientEmail, invoice, walkPhotos = [] } = await req.json();
    const firstName = (clientName || "").split(" ")[0] || "there";

    const total = Number(invoice?.total ?? 0);
    const dueDate = invoice?.dueDate
      ? new Date(invoice.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "Upon receipt";

    // Parse the item description: "Buddy · 30 min · Monday, April 14, 2026"
    const rawDesc: string = (invoice?.items?.[0]?.description || "");
    const descParts = rawDesc.split(" · ");
    const petName   = descParts[0] || null;
    const duration  = descParts[1] || null;
    const walkDate  = descParts.slice(2).join(", ") || null;

    // Build line item rows
    const itemRows = (invoice?.items || []).map((item: { description: string; amount: number }) =>
      `<tr>
        <td style="padding:10px 0;color:#374151;font-size:14px;border-bottom:1px solid #f3f4f6;line-height:1.5;">${item.description}</td>
        <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:700;border-bottom:1px solid #f3f4f6;text-align:right;white-space:nowrap;">$${Number(item.amount).toFixed(2)}</td>
      </tr>`
    ).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Great walk today! — Lonestar Bark Co.</title>
</head>
<body style="margin:0;padding:0;background-color:#fdf6f0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fdf6f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.08);">

        <!-- ── Header ─────────────────────────────────────────── -->
        <tr>
          <td style="background:#0B1423;padding:36px 40px;text-align:center;">
            <div style="font-size:40px;margin-bottom:12px;line-height:1;">🐾</div>
            <div style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Lonestar Bark Co.</div>
            <div style="color:#9B7444;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-top:6px;">East Dallas Dog Walking</div>
          </td>
        </tr>

        <!-- ── Hero ───────────────────────────────────────────── -->
        <tr>
          <td style="background:linear-gradient(135deg,#C4541A 0%,#e8793a 100%);padding:28px 40px;text-align:center;">
            <div style="color:#ffffff;font-size:26px;font-weight:800;margin-bottom:6px;letter-spacing:-0.3px;">
              Great walk today! 🎉
            </div>
            <div style="color:rgba(255,255,255,0.9);font-size:15px;line-height:1.6;">
              Hey <strong>${firstName}</strong>! ${petName ? `<strong>${petName}</strong> had an amazing time` : "Your pup had an amazing time"} and we couldn't be happier to be part of your pack.
            </div>
          </td>
        </tr>

        <!-- ── Walk summary card ─────────────────────────────── -->
        ${(petName || duration || walkDate) ? `
        <tr>
          <td style="padding:28px 40px 0;">
            <table cellpadding="0" cellspacing="0" width="100%" style="background:#fff8f3;border:1.5px solid #fde5d4;border-radius:14px;overflow:hidden;">
              <tr>
                <td style="background:#fde5d4;padding:12px 20px;">
                  <span style="color:#C4541A;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;">Walk Summary</span>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 20px;">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    ${petName ? `
                    <tr>
                      <td style="color:#9ca3af;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding-bottom:10px;width:40%;">Fur Baby</td>
                      <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">🐶 ${petName}</td>
                    </tr>` : ""}
                    ${duration ? `
                    <tr>
                      <td style="color:#9ca3af;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding-bottom:10px;">Duration</td>
                      <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">⏱ ${duration}</td>
                    </tr>` : ""}
                    ${walkDate ? `
                    <tr>
                      <td style="color:#9ca3af;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Date</td>
                      <td style="color:#111827;font-size:14px;font-weight:700;">📅 ${walkDate}</td>
                    </tr>` : ""}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ""}

        <!-- ── Invoice section ───────────────────────────────── -->
        <tr>
          <td style="padding:28px 40px 0;">
            <div style="color:#C4541A;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px;">Invoice</div>
            <div style="color:#9ca3af;font-size:13px;margin-bottom:16px;">#${invoice?.id || "—"}</div>

            <table cellpadding="0" cellspacing="0" width="100%" style="border:1.5px solid #e4e7ec;border-radius:12px;overflow:hidden;">
              <!-- Line items -->
              <tr>
                <td style="padding:0 20px;">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    ${itemRows}
                  </table>
                </td>
              </tr>
              <!-- Total row -->
              <tr>
                <td style="background:#f9fafb;padding:16px 20px;border-top:1.5px solid #e4e7ec;">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="color:#111827;font-size:16px;font-weight:800;">Total Due</td>
                      <td style="color:#C4541A;font-size:22px;font-weight:800;text-align:right;">$${total.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td colspan="2" style="color:#9ca3af;font-size:12px;padding-top:4px;">Due by ${dueDate}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── Walk Photos ───────────────────────────────────── -->
        ${(walkPhotos as string[]).length > 0 ? `
        <tr>
          <td style="padding:0 40px 28px;">
            <div style="color:#C4541A;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px;">Photos from today's walk 📸</div>
            <div style="color:#9ca3af;font-size:12px;margin-bottom:14px;">Tap any photo to view full size or save to your device.</div>
            ${(walkPhotos as string[]).map((url: string, i: number) => `
            <a href="${url}" target="_blank" rel="noreferrer"
              style="display:block;margin-bottom:12px;border-radius:12px;overflow:hidden;border:1.5px solid #f3f4f6;text-decoration:none;">
              <img src="${url}" alt="Walk photo ${i + 1}"
                style="width:100%;height:auto;display:block;border-radius:10px;" />
            </a>`).join("")}
          </td>
        </tr>` : ""}

        <!-- ── CTA ────────────────────────────────────────────── -->
        <tr>
          <td style="padding:28px 40px 36px;text-align:center;">
            <a href="https://lonestarbarkco.com"
               style="display:inline-block;padding:16px 40px;background:#C4541A;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:12px;letter-spacing:0.3px;">
              Pay Invoice →
            </a>
            <p style="margin:16px 0 0;color:#9ca3af;font-size:13px;line-height:1.6;">
              You can pay securely anytime through your client portal.<br>Questions? Just reply to this email — we're always here.
            </p>
          </td>
        </tr>

        <!-- ── Divider ─────────────────────────────────────────── -->
        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #f3f4f6;margin:0;" /></td></tr>

        <!-- ── Footer ─────────────────────────────────────────── -->
        <tr>
          <td style="padding:24px 40px;text-align:center;">
            <p style="margin:0 0 6px;color:#C4541A;font-size:14px;font-weight:700;">Thank you for trusting us with your pup. 🤠</p>
            <p style="margin:0 0 14px;color:#6b7280;font-size:13px;line-height:1.6;">We love what we do and it's because of families like yours.</p>
            <p style="margin:0;color:#9ca3af;font-size:12px;">
              <a href="mailto:hello@lonestarbarkco.com" style="color:#C4541A;text-decoration:none;">hello@lonestarbarkco.com</a>
            </p>
            <p style="margin:6px 0 0;color:#d1d5db;font-size:12px;">Lonestar Bark Co. · East Dallas, TX</p>
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
        subject: `🐾 Great walk today, ${firstName}! Your invoice is ready.`,
        html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-invoice-email error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
