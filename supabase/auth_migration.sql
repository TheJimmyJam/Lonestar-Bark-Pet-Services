-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Auth migration for Lonestar Bark clients
--
-- Adds a `user_id` column to the existing `clients` table linking each client
-- row to a Supabase auth.users row. Staff (admins, walkers) continue to use
-- the PIN-based system; only clients are moved to Supabase Auth.
--
-- The `pin` column remains the primary key — Supabase-Auth clients get a
-- synthetic PIN (e.g. "au_<first 10 chars of user_id>") generated at signup,
-- so the in-memory clients map keyed by PIN keeps working without touching
-- BookingApp / AdminDashboard / email flows.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);

-- Enforce one client row per auth user (when user_id is set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_user_id_unique
  ON clients(user_id)
  WHERE user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: Supabase dashboard steps still required AFTER running this migration:
--
-- 1. Auth → Providers → Google: enable, paste OAuth client ID/secret
--    (create credentials in Google Cloud Console, add callback
--     https://mvkmxmhsudqwxrsiifms.supabase.co/auth/v1/callback)
-- 2. Auth → URL Configuration → Redirect URLs:
--      https://lonestarbarkco.com
--      https://lonestarbarkco.com/
--      http://localhost:5173
--      http://localhost:5173/
-- 3. Auth → Email Templates: customize confirmation + reset emails
--    (defaults work; branding is optional)
-- 4. Auth → Settings: confirm "Enable email confirmations" is ON
-- ─────────────────────────────────────────────────────────────────────────────
