-- Persist only the selected bundled avatar identifier in the existing profile row.
-- Review the deployed schema and policies before running; this file is not auto-applied.

begin;

alter table public.profiles
  add column if not exists avatar_id text;

update public.profiles
set avatar_id = 'fern'
where avatar_id is null;

alter table public.profiles
  alter column avatar_id set default 'fern',
  alter column avatar_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_avatar_id_allowed_check'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_id_allowed_check
      check (avatar_id in ('fern', 'terracotta', 'sage', 'indigo', 'ochre'));
  end if;
end;
$$;

grant update (avatar_id) on public.profiles to authenticated;

notify pgrst, 'reload schema';

commit;

-- Manual rollback (existing profile rows and other profile fields are preserved):
-- begin;
-- revoke update (avatar_id) on public.profiles from authenticated;
-- alter table public.profiles
--   drop constraint profiles_avatar_id_allowed_check;
-- alter table public.profiles
--   drop column avatar_id;
-- notify pgrst, 'reload schema';
-- commit;
