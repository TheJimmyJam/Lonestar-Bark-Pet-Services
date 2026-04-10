-- ─── Audit Log Table ─────────────────────────────────────────────────────────
-- Run this once in your Supabase SQL editor:
-- https://supabase.com/dashboard/project/mvkmxmhsudqwxrsiifms/sql

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  admin_id    text,
  admin_name  text,
  action      text not null,
  entity_type text,
  entity_id   text,
  details     jsonb,
  created_at  timestamptz default now()
);

-- Index for fast filtering by admin, entity, or time
create index if not exists audit_log_admin_id_idx    on audit_log (admin_id);
create index if not exists audit_log_entity_type_idx on audit_log (entity_type);
create index if not exists audit_log_created_at_idx  on audit_log (created_at desc);

-- Allow the anon key to insert (admins write log events from the client)
alter table audit_log enable row level security;

create policy "Allow anon insert" on audit_log
  for insert to anon with check (true);

create policy "Allow anon read" on audit_log
  for select to anon using (true);
