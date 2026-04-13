import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = Deno.env.get("APP_URL") || "https://lonestarbarkco.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sends a walker an email invite so they can set their password and log in.
// - New user → sends Supabase invite email (magic link to set password)
// - Existing user → sends password reset email instead (same UX outcome)
// Both redirect back to the app with ?walker_invite=1 so App.jsx can show
// the password setup screen.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, name } = await req.json();
    if (!email || !name) throw new Error("email and name are required");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const redirectTo = `${APP_URL}/?walker_invite=1`;

    // Check whether this email already has a Supabase Auth account
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (existing) {
      // Already has an account — send a password reset so they can get in
      await supabaseAdmin.auth.resetPasswordForEmail(email.toLowerCase(), { redirectTo });
      return new Response(JSON.stringify({ sent: true, type: "reset", user_id: existing.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // New account — send invite email
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.toLowerCase(),
      { redirectTo, data: { name, role: "walker" } }
    );
    if (error) throw error;

    return new Response(JSON.stringify({ sent: true, type: "invite", user_id: data.user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[invite-walker]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
