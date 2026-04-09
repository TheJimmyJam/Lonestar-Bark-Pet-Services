import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Lonestar Bark Co. <invoices@lonestarbarkco.com>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { clientName, clientEmail, invoice } = await req.json();

    if (!clientEmail || !invoice) {
      return new Response(
        JSON.stringify({ error: "Missing clientEmail or invoice" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const firstName = (clientName || "").split(" ")[0] || "there";
    const items = invoice.items || [];
    const total = invoice.total || 0;
    const dueDate = invoice.dueDate
      ? new Date(invoice.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "Upon receipt";
    const invoiceId = invoice.id || "N/A";
    const invoiceType = invoice.type === "walk" ? "Walk" : "Service";
    const notes = invoice.notes || "";

    // Build line items HTML
    const itemsHtml = items.map((it: any) =>
      `<tr>
        <td style="padding:10px 16px;border-bottom:1px solid #f0ece6;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#374151;">${it.description || "Service"}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #f0ece6;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#374151;text-align:right;">$${(it.amount || 0).toFixed(2)}</td>
      </tr>`
    ).join("");

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <!-- Header -->
    <div style="background:#0B1423;border-radius:16px 16px 0 0;padding:32px 28px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px;">🐾</div>
      <div style="color:#ffffff;font-size:18px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">
        Lonestar Bark Co.
      </div>
      <div style="color:#D4A843;font-size:12px;letter-spacing:3px;text-transform:uppercase;">
        Born Here &middot; Walk Here &middot; Dallas, TX
      </div>
    </div>

    <!-- Body -->
    <div style="background:#ffffff;padding:32px 28px;border-left:1px solid #e8e4de;border-right:1px solid #e8e4de;">
      <div style="font-size:16px;color:#374151;line-height:1.6;margin-bottom:24px;">
        Hi ${firstName},
      </div>
      <div style="font-size:16px;color:#374151;line-height:1.6;margin-bottom:24px;">
        A new invoice has been created for your account. Here are the details:
      </div>

      <!-- Invoice meta -->
      <div style="background:#faf8f5;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Invoice</td>
            <td style="padding:4px 0;font-size:15px;color:#111827;text-align:right;font-weight:600;">${invoiceId}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Type</td>
            <td style="padding:4px 0;font-size:15px;color:#111827;text-align:right;">${invoiceType}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Due Date</td>
            <td style="padding:4px 0;font-size:15px;color:#C4541A;text-align:right;font-weight:600;">${dueDate}</td>
          </tr>
        </table>
      </div>

      <!-- Line items -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#faf8f5;">
            <th style="padding:10px 16px;text-align:left;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Description</th>
            <th style="padding:10px 16px;text-align:right;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #e8e4de;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <!-- Total -->
      <div style="background:#0B1423;border-radius:10px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <table style="width:100%;">
          <tr>
            <td style="font-size:14px;color:#ffffffaa;text-transform:uppercase;letter-spacing:1px;">Total Due</td>
            <td style="font-size:24px;color:#ffffff;font-weight:700;text-align:right;">$${total.toFixed(2)}</td>
          </tr>
        </table>
      </div>

      ${notes ? `
      <div style="background:#fffbeb;border:1px solid #D4A843;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
        <div style="font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Notes</div>
        <div style="font-size:15px;color:#374151;line-height:1.6;">${notes}</div>
      </div>
      ` : ""}

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:24px;">
        <a href="https://lonestarbark.netlify.app" style="display:inline-block;padding:14px 36px;background:#C4541A;color:#ffffff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:600;letter-spacing:0.3px;">
          View in Portal →
        </a>
      </div>

      <div style="font-size:14px;color:#9ca3af;line-height:1.6;text-align:center;">
        Log in to your client portal to view details and payment options.
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#0B1423;border-radius:0 0 16px 16px;padding:20px 28px;text-align:center;">
      <div style="color:#ffffffaa;font-size:13px;letter-spacing:0.5px;margin-bottom:4px;">
        Lonestar Bark Co. &middot; East Dallas, TX
      </div>
      <div style="color:#D4A843;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;">
        Born Here. Walk Here.
      </div>
    </div>
  </div>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [clientEmail],
        subject: `Invoice ${invoiceId} — $${total.toFixed(2)} due ${dueDate}`,
        html,
      }),
    });

    const result = await res.json();
    console.log(`[send-invoice-email] ${clientEmail} → ${res.status}`, result);

    return new Response(
      JSON.stringify({ success: true, resendId: result.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[send-invoice-email] error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
