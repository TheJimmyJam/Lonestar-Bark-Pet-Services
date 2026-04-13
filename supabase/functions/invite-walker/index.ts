import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_URL              = Deno.env.get("APP_URL") || "https://lonestarbarkco.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const adminHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "apikey": SERVICE_ROLE_KEY,
};

// Sends a walker an email invite so they can set their password and log in.
// - New user  → Supabase invite email (magic link to set password)
// - Existing  → password-reset email (same UX outcome)
// Both redirect back to the app with ?walker_invite=1 so App.jsx can show
// the password-setup screen on arrival.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, name } = await req.json();
    if (!email || !name) throw new Error("email and name are required");

    const emailLower   = email.trim().toLowerCase();
    const redirectTo   = `${APP_URL}/?walker_invite=1`;

    // ── Check for existing Supabase Auth account ─────────────────────────────
    // GET /auth/v1/admin/users?filter=email%3D%3C...%3E
    const listRes  = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
      { headers: adminHeaders }
    );
    const listData = await listRes.json();
    const users: { id: string; email: string }[] = listData.users || [];
    const existing = users.find(
      (u) => u.email?.toLowerCase() === emailLower
    );

    if (existing) {
      // Already has an account — send password-reset so they can get back in
      const resetRes = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ email: emailLower, redirect_to: redirectTo }),
      });
      const resetData = await resetRes.json();
      if (!resetRes.ok) throw new Error(resetData.message || "Failed to send reset email");

      return new Response(
        JSON.stringify({ sent: true, type: "reset", user_id: existing.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── New account — send Supabase invite email ──────────────────────────────
    const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: emailLower,
        redirect_to: redirectTo,
        data: { name, role: "walker" },
      }),
    });
    const inviteData = await inviteRes.json();
    if (!inviteRes.ok) throw new Error(inviteData.message || "Failed to send invite email");

    return new Response(
      JSON.stringify({ sent: true, type: "invite", user_id: inviteData.id }),
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
