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

// Sets (or resets) a walker's Supabase Auth password.
// Called when a walker sets their password for the first time, or resets it.
// Creates the Supabase Auth user on-the-fly if they were never provisioned
// (handles the auto-migration path for walkers who had PINs before this system).
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, pin, name } = await req.json();
    if (!email || !pin) throw new Error("email and pin are required");
    if (pin.length < 8) throw new Error("Password must be at least 8 characters");

    const emailLower = email.trim().toLowerCase();

    // Look up whether a Supabase Auth user already exists for this email
    const listRes  = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
      { headers: adminHeaders }
    );
    const listData = await listRes.json();
    const users: { id: string; email: string }[] = listData.users || [];
    const existing = users.find((u) => u.email?.toLowerCase() === emailLower);

    if (!existing) {
      // Walker was never provisioned (pre-migration). Create them now.
      const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          email: emailLower,
          password: pin,
          email_confirm: true,
          user_metadata: { name: name || email, role: "walker" },
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.message || "Failed to create user");

      return new Response(
        JSON.stringify({ success: true, created: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update existing user's password
    const updateRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${existing.id}`,
      {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ password: pin }),
      }
    );
    const updateData = await updateRes.json();
    if (!updateRes.ok) throw new Error(updateData.message || "Failed to update password");

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("[set-walker-pin]", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
