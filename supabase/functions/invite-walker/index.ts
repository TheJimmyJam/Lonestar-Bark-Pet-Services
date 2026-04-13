import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY") || "";
const APP_URL          = Deno.env.get("APP_URL") || "https://lonestarbarkco.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const adminHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "apikey": SERVICE_ROLE_KEY,
};

// Invites a new walker by:
// 1. Creating (or finding) their Supabase Auth account with a temp password.
// 2. Sending a branded Resend email with a direct link to the walker portal.
//
// We intentionally avoid Supabase's built-in invite/magic-link flow because
// their default email template says "create a user" and their redirect lands
// on the client signup screen, not the walker portal.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, name } = await req.json();
    if (!email || !name) throw new Error("email and name are required");

    const emailLower = email.trim().toLowerCase();
    const firstName  = name.trim().split(" ")[0];

    // ── 1. Ensure a Supabase Auth account exists ──────────────────────────────
    const listRes  = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
      { headers: adminHeaders }
    );
    const listData = await listRes.json();
    const users    = (listData.users || []) as { id: string; email: string }[];
    const existing = users.find((u) => u.email?.toLowerCase() === emailLower);

    let userId = existing?.id;

    if (!existing) {
      // Create with a random temp password (walker will set their real one via the portal)
      const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          email: emailLower,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { name: name.trim(), role: "walker" },
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.message || "Failed to create auth account");
      userId = createData.id;
    }

    // ── 2. Send branded invite email via Resend ───────────────────────────────
    const walkerPortalUrl = `${APP_URL}/?setup=walker`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#0B1423;padding:28px 36px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#fff;">🐾 Lonestar Bark Co.</p>
          <p style="margin:6px 0 0;font-size:11px;color:#9B7444;letter-spacing:3px;text-transform:uppercase;">Walker Portal</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 36px;">
          <p style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Welcome to the team, ${firstName}! 🎉</p>
          <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">
            You've been added as a walker on the Lonestar Bark platform.
            Click below to set up your walker account and password.
          </p>

          <!-- CTA Button -->
          <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td style="background:#C4541A;border-radius:10px;">
              <a href="${walkerPortalUrl}"
                 style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:700;color:#fff;text-decoration:none;font-family:Helvetica,Arial,sans-serif;">
                Set Up My Walker Account →
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;line-height:1.6;">
            When you arrive, select <strong>Walker Login</strong>, enter this email address
            (<strong>${emailLower}</strong>), and follow the prompts to create your password.
          </p>

          <p style="margin:16px 0 0;font-size:13px;color:#9ca3af;">
            If the button above doesn't work, copy and paste this link:<br>
            <a href="${walkerPortalUrl}" style="color:#C4541A;">${walkerPortalUrl}</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e4e7ec;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            Lonestar Bark Co. · East Dallas, TX ·
            <a href="mailto:hello@lonestarbarkco.com" style="color:#9ca3af;">hello@lonestarbarkco.com</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Lonestar Bark <hello@send.lonestarbarkco.com>",
        to:   [emailLower],
        subject: `Welcome to Lonestar Bark, ${firstName}! Set up your walker account`,
        html,
      }),
    });

    const emailData = await emailRes.json();
    if (!emailRes.ok) throw new Error(emailData.message || JSON.stringify(emailData));

    return new Response(
      JSON.stringify({ sent: true, user_id: userId, resend_id: emailData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("[invite-walker]", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
