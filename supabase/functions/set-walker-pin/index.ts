import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sets (or resets) a walker's Supabase Auth password to their chosen PIN.
// Called when a walker sets their PIN for the first time, or after a PIN reset.
// Creates the Supabase Auth user on-the-fly if they were never provisioned
// (handles the auto-migration path for walkers who had PINs before this system).
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, pin, name } = await req.json();
    if (!email || !pin) throw new Error("email and pin are required");
    if (pin.length < 4) throw new Error("PIN must be at least 4 digits");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;

    const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      // Walker was never provisioned (pre-migration). Create them now.
      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email.toLowerCase(),
        password: pin,
        email_confirm: true,
        user_metadata: { name: name || email, role: "walker" },
      });
      if (createError) throw createError;

      return new Response(JSON.stringify({ success: true, created: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update existing user's password to the new PIN
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: pin,
    });
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[set-walker-pin]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
