import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const adminHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "apikey": SERVICE_ROLE_KEY,
};

// Called by the admin dashboard when adding a new walker.
// Creates a Supabase Auth account for the walker (using service role).
// Idempotent: if an account with that email already exists, returns the existing user_id.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, name } = await req.json();
    if (!email || !name) throw new Error("email and name are required");

    const emailLower = email.trim().toLowerCase();

    // Check if a user with this email already exists
    const listRes  = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
      { headers: adminHeaders }
    );
    const listData = await listRes.json();
    const users: { id: string; email: string }[] = listData.users || [];
    const existing = users.find((u) => u.email?.toLowerCase() === emailLower);

    if (existing) {
      // Already provisioned — return their id
      return new Response(
        JSON.stringify({ user_id: existing.id, existed: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a new auth user with a random temp password.
    // The walker sets their real password on first login via the set-walker-pin function.
    const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 20);

    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: emailLower,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { name, role: "walker" },
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(createData.message || "Failed to create user");

    return new Response(
      JSON.stringify({ user_id: createData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("[create-walker-account]", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
