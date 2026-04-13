import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Called by the admin dashboard when adding a new walker.
// Creates a Supabase Auth account for the walker (using service role).
// Idempotent: if an account with that email already exists, returns the existing user_id.
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

    // Check if a user with this email already exists
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;

    const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      // Already provisioned — return their id
      return new Response(JSON.stringify({ user_id: existing.id, existed: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create a new auth user with a random temp password.
    // The walker will set their real PIN on first login via the set-walker-pin function.
    const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 20);

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password: tempPassword,
      email_confirm: true,           // skip email confirmation — admin is adding them
      user_metadata: { name, role: "walker" },
    });

    if (error) throw error;

    return new Response(JSON.stringify({ user_id: data.user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[create-walker-account]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
