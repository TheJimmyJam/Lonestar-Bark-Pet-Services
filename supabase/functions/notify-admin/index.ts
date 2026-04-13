import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY    = Deno.env.get("RESEND_API_KEY") || "";
const ADMIN_EMAIL       = Deno.env.get("ADMIN_EMAIL") || "jimmy@lonestarbarkco.com";
// A shared secret set in Supabase Edge Function secrets (NOT the anon key).
// The client sends this in x-app-key; anything else is rejected.
const NOTIFY_SECRET     = Deno.env.get("NOTIFY_ADMIN_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-key",
};

// ── Auth check ────────────────────────────────────────────────────────────────
// Rejects callers that don't know the NOTIFY_ADMIN_SECRET.
// This prevents anyone who only has the public anon key from spamming the
// admin inbox with fake notifications.
function isAuthorized(req: Request): boolean {
  if (!NOTIFY_SECRET) {
    // Secret not configured — fail open in dev, log a warning
    console.warn("[notify-admin] NOTIFY_ADMIN_SECRET is not set. Auth check skipped.");
    return true;
  }
  const provided = req.headers.get("x-app-key") || "";
  return provided === NOTIFY_SECRET;
}

// ── Label map ─────────────────────────────────────────────────────────────────
const LABELS: Record<string, string> = {
  new_client:        "New Client Registered",
  new_booking:       "New Booking",
  walk_confirmed:    "Walk Confirmed by Walker",
  walk_completed:    "Walk Marked Complete",
  new_client_message:"New Client Message",
  shift_trade:       "Shift Trade Request",
  new_applicant:     "New Walker Application",
  free_walk_claimed: "Free Walk Redeemed (Punch Card)",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { type, data } = await req.json();
    const label = LABELS[type] || type;

    // Build a simple text summary of the payload
    const details = Object.entries(data || {})
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;">${k}</td><td style="padding:4px 0;font-size:14px;color:#111827;">${v}</td></tr>`)
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
        <tr><td style="background:#0B1423;padding:24px 36px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">🐾 Lonestar Bark Co.</p>
          <p style="margin:6px 0 0;font-size:11px;color:#9B7444;letter-spacing:3px;text-transform:uppercase;">Admin Notification</p>
        </td></tr>
        <tr><td style="padding:28px 36px;">
          <p style="margin:0 0 20px;font-size:17px;font-weight:700;color:#111827;">${label}</p>
          <table cellpadding="0" cellspacing="0">${details}</table>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e4e7ec;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">Lonestar Bark Co. · East Dallas, TX</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Lonestar Bark <hello@send.lonestarbarkco.com>",
        to: [ADMIN_EMAIL],
        subject: `[Lonestar Bark] ${label}`,
        html,
      }),
    });

    const body = await res.json();
    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[notify-admin]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
