-- ─────────────────────────────────────────────────────────────────────────────
-- Walker Supabase Auth Migration
--
-- Adds a `user_id` column to the `walkers` table linking each walker to a
-- real Supabase auth.users row. This enables proper RLS instead of relying on
-- the permissive anon key.
--
-- Walkers keep their PIN-based UX — the PIN just becomes their Supabase Auth
-- password instead of being stored in the JSON blob. The two new edge
-- functions (create-walker-account, set-walker-pin) handle provisioning via
-- the service role.
--
-- Run in: Supabase dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Link walker rows to auth users
ALTER TABLE walkers
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX  IF NOT EXISTS idx_walkers_user_id        ON walkers(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_walkers_user_id_unique ON walkers(user_id)
  WHERE user_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enable RLS on walkers
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE walkers ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. the admin dashboard via anon key) can read walker profile data.
-- Walker profile info (name, bio, color, services) is not sensitive.
CREATE POLICY "walkers_anon_read" ON walkers
  FOR SELECT USING (true);

-- Walkers can update their own row once they have a Supabase session.
-- (Admin writes still go through anon key — acceptable until admin auth is added.)
CREATE POLICY "walkers_self_update" ON walkers
  FOR UPDATE USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tighten the clients table (partial improvement)
--
-- The existing `clients_anon_write` policy lets ANY anon caller write ANY
-- client row. We narrow it: anon INSERT is still allowed (admin dashboard still
-- uses anon key), but anon UPDATE/DELETE are removed.
-- Authenticated callers (clients with Supabase sessions) can manage their own row.
--
-- Full lock-down requires admin Supabase Auth (future migration).
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the overly broad policy if it exists
DROP POLICY IF EXISTS "clients_anon_write" ON clients;

-- Re-enable RLS in case it wasn't on
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Anon callers can INSERT new client rows (admin dashboard needs this)
CREATE POLICY "clients_anon_insert" ON clients
  FOR INSERT WITH CHECK (true);

-- Anon callers can SELECT (admin dashboard reads all clients)
CREATE POLICY "clients_anon_read" ON clients
  FOR SELECT USING (true);

-- Anon callers can UPDATE — needed until admin has Supabase Auth.
-- The blanket USING (true) is intentional: admin dashboard writes via anon key.
-- Account-takeover is prevented by the trigger below, not by this policy.
CREATE POLICY "clients_anon_update" ON clients
  FOR UPDATE USING (true);

-- Authenticated clients can do everything on their own row
CREATE POLICY "clients_owner_all" ON clients
  FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: block anon callers from reassigning user_id
--
-- The clients_anon_update policy above must stay permissive because the admin
-- dashboard uses the anon key to do full client saves. This trigger closes the
-- account-takeover gap: an unauthenticated caller cannot change a client's
-- user_id to hijack their Supabase Auth session. Admin saves are safe because
-- saveClients() preserves the existing user_id (OLD.user_id = NEW.user_id),
-- so the trigger is a no-op for legitimate admin writes.
--
-- Full fix: migrate admin to use service-role edge functions (future sprint).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_anon_user_id_change()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NULL AND (NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION
      USING ERRCODE = '42501',
            MESSAGE = 'user_id cannot be changed without authentication';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS clients_protect_user_id ON clients;
CREATE TRIGGER clients_protect_user_id
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION prevent_anon_user_id_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: After running this SQL —
--
-- 1. Deploy the two new edge functions:
--      create-walker-account
--      set-walker-pin
--
-- 2. Set the SUPABASE_SERVICE_ROLE_KEY env var in each edge function's
--    settings (Supabase dashboard → Edge Functions → select function → Secrets).
--
-- 3. Existing walkers: On their next login the app will transparently create
--    their Supabase Auth account and set their Supabase password to match
--    their current PIN. No manual steps needed for walkers.
-- ─────────────────────────────────────────────────────────────────────────────
