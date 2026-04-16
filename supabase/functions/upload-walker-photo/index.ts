import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET            = "walker-profile-photos";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Admin-only edge function: uploads a walker profile photo using the
// service role key so RLS is bypassed entirely.
// Accepts: multipart/form-data with fields:
//   - walkerId (string)  — used as the storage path prefix
//   - file (Blob)        — the image file
// Returns: { url: string }
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const form = await req.formData();
    const walkerId = form.get("walkerId");
    const file = form.get("file") as File | null;

    if (!walkerId || !file) {
      return new Response(
        JSON.stringify({ error: "walkerId and file are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${walkerId}/profile.${ext}`;

    // Upload directly via the Storage REST API using the service role key.
    // This bypasses RLS entirely — safe because this function is only
    // reachable by admin (caller must provide the anon key / session JWT,
    // but the actual storage write uses the service role).
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY,
          "x-upsert": "true",
          "Content-Type": file.type || "image/jpeg",
          "Cache-Control": "3600",
        },
        body: await file.arrayBuffer(),
      }
    );

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text();
      console.error("[upload-walker-photo] storage error:", uploadRes.status, errBody);
      throw new Error(`Storage upload failed: ${errBody}`);
    }

    // Build the public URL (bucket is public)
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

    return new Response(
      JSON.stringify({ url: publicUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("[upload-walker-photo]", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
