# Supabase setup for The Fold

This configuration intentionally uses a **publishable** Supabase key in the React app. A publishable key is not an authorization secret: each database and Storage request also carries the signed-in user's Supabase Auth session, and Row Level Security (RLS) policies constrain access to that user. Do not disable RLS or make the photo bucket public.

Wardrobe metadata is stored in Supabase Postgres. Compressed WebP photos are stored in Supabase Storage. FastAPI/Pillow remains the image-processing service and checks the caller's Supabase access token against Supabase Auth. No service-role key is needed by this application.

## 1. Create the private photo bucket

In the Supabase Dashboard:

1. Open **Storage → New bucket**.
2. Name it `wardrobe-images`.
3. Keep **Public bucket** disabled.
4. Set the maximum file size to `8 MB`.
5. Set **Allowed MIME types** to include `image/webp`. The image API converts every accepted upload to WebP, and the browser sends `content-type: image/webp`. If the bucket already exists, edit its allowed MIME types; a bucket restriction that omits WebP causes uploads to fail with `mime type image/webp is not supported`.
6. Create the bucket.

The SQL below grants users access only to objects whose first path segment is their own Auth user UUID. The app writes objects as `<auth-user-uuid>/<random-uuid>.webp`.

If you prefer to update an existing bucket in the SQL Editor, first confirm the bucket ID and preserve its current private setting. Then allow the app's output format:

```sql
update storage.buckets
set allowed_mime_types = array['image/webp']
where id = 'wardrobe-images';
```

This changes only the accepted MIME type; it does not make the bucket public. Do not run the update if it unexpectedly affects zero rows; create or correct the bucket in **Storage → Buckets** instead.

## 2. Create tables, consent bootstrap, and RLS policies

Open **SQL Editor → New query** and run this script once. If the objects already exist, review the existing policies before applying a modified migration.

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.consent_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('terms', 'privacy', 'age')),
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, consent_type, version)
);

create table if not exists public.clothing_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null unique,
  category text not null check (category in ('Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Accessories')),
  clothing_type text not null default '' check (char_length(clothing_type) <= 60),
  dominant_color text not null default '' check (char_length(dominant_color) <= 40),
  secondary_color text check (secondary_color is null or char_length(secondary_color) <= 40),
  color_family text check (color_family is null or char_length(color_family) <= 40),
  brightness text check (brightness is null or char_length(brightness) <= 30),
  pattern text check (pattern is null or char_length(pattern) <= 40),
  season text not null check (season <> '' and char_length(season) <= 30),
  formality text not null check (formality <> '' and char_length(formality) <= 40),
  occasion text not null check (occasion <> '' and char_length(occasion) <= 60),
  notes text not null default '' check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (split_part(image_path, '/', 1) = user_id::text)
);

create index if not exists clothing_items_owner_category_idx
  on public.clothing_items(user_id, category, created_at desc);

create table if not exists public.outfits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create index if not exists outfits_owner_created_idx
  on public.outfits(user_id, created_at desc);

create table if not exists public.outfit_items (
  outfit_id bigint not null references public.outfits(id) on delete cascade,
  clothing_id bigint not null references public.clothing_items(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  primary key (outfit_id, clothing_id)
);

create or replace function public.bootstrap_wardrobe_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata jsonb := new.raw_user_meta_data;
begin
  if metadata ->> 'age_confirmed' is distinct from 'true'
     or metadata ->> 'terms_accepted' is distinct from 'true'
     or metadata ->> 'privacy_accepted' is distinct from 'true' then
    raise exception 'Age, terms and privacy acknowledgement are required';
  end if;

  insert into public.profiles (id, full_name)
  values (new.id, left(trim(coalesce(metadata ->> 'full_name', '')), 80));

  insert into public.consent_records (user_id, consent_type, version)
  values
    (new.id, 'age', '1.0'),
    (new.id, 'terms', coalesce(metadata ->> 'terms_version', '1.0')),
    (new.id, 'privacy', coalesce(metadata ->> 'privacy_version', '1.0'));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_wardrobe on auth.users;
create trigger on_auth_user_created_wardrobe
  after insert on auth.users
  for each row execute function public.bootstrap_wardrobe_account();

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_profile_updated_at();

create or replace function public.set_clothing_item_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clothing_items_updated_at on public.clothing_items;
create trigger clothing_items_updated_at
  before update on public.clothing_items
  for each row execute function public.set_clothing_item_updated_at();

alter table public.profiles enable row level security;
alter table public.consent_records enable row level security;
alter table public.clothing_items enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;

drop policy if exists "Profiles readable by owner" on public.profiles;
create policy "Profiles readable by owner" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Profiles editable by owner" on public.profiles;
create policy "Profiles editable by owner" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Consent readable by owner" on public.consent_records;
create policy "Consent readable by owner" on public.consent_records
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Clothing owned by account" on public.clothing_items;
create policy "Clothing owned by account" on public.clothing_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Outfits owned by account" on public.outfits;
create policy "Outfits owned by account" on public.outfits
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Outfit links owned by account" on public.outfit_items;
create policy "Outfit links owned by account" on public.outfit_items
  for all to authenticated
  using (exists (
    select 1 from public.outfits o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  ))
  with check (
    exists (
      select 1 from public.outfits o
      where o.id = outfit_id and o.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.clothing_items c
      where c.id = clothing_id and c.user_id = (select auth.uid())
    )
  );

drop policy if exists "Private wardrobe images readable by owner" on storage.objects;
create policy "Private wardrobe images readable by owner" on storage.objects
  for select to authenticated
  using (bucket_id = 'wardrobe-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Private wardrobe images uploadable by owner" on storage.objects;
create policy "Private wardrobe images uploadable by owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wardrobe-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Private wardrobe images deletable by owner" on storage.objects;
create policy "Private wardrobe images deletable by owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wardrobe-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select on public.consent_records to authenticated;
grant select, insert, update, delete on public.clothing_items to authenticated;
grant select, insert, update, delete on public.outfits to authenticated;
grant select, insert, update, delete on public.outfit_items to authenticated;
grant usage, select on sequence public.consent_records_id_seq to authenticated;
```

### Built-in avatar migration

The base `profiles` table above contains no avatar selection field. The previous frontend attempt used `profiles.avatar`, and the earlier local migration draft used `avatar_path`; neither is part of this built-in avatar design. No migration history or live database connection in this repository proves that either draft was applied in Supabase. After verifying the deployed `public.profiles` table and resolving any unexpected existing columns, review and apply [`supabase/migrations/20260926_add_profiles_avatar_id.sql`](./supabase/migrations/20260926_add_profiles_avatar_id.sql) manually. It stores only one of the built-in avatar IDs (`fern`, `terracotta`, `sage`, `indigo`, or `ochre`), defaults existing and new rows to `fern`, and grants the authenticated role permission to update only that column. It does not create a bucket or new Storage policies.

If Supabase already has an `avatar_path` column from a prior manual run, keep it unchanged during this migration; it does not map reliably to a bundled avatar ID. Confirm the column's contents and dependencies separately before deciding whether to clean it up. If an `avatar_id` column already exists, compare its type, nullability, default, constraints, and values with the migration first; the SQL intentionally does not overwrite existing non-null selections, and it will fail rather than accept unsupported IDs.

### Tables

- `profiles`: user display name and timestamps; row ID is the corresponding Supabase Auth user UUID. The `avatar_id` selection is added by the separate migration above.
- `consent_records`: immutable age, terms, and privacy acknowledgements captured by the Auth-user trigger.
- `clothing_items`: user-owned clothing metadata plus the private Storage object path. Photo bytes are **not** stored in Postgres.
- `outfits`: named saved outfit owned by one Auth user.
- `outfit_items`: ordered references joining an outfit to that owner's clothing items.
- `storage.objects`: managed by Supabase; app policies restrict objects in `wardrobe-images` by user UUID prefix.

### Existing deployments: structured Main 9 attributes

For an existing installation created with the earlier `color` and `subcategory` columns, review the deployed `public.clothing_items` schema and apply [`supabase/migrations/20261002_add_structured_ai_clothing_attributes.sql`](./supabase/migrations/20261002_add_structured_ai_clothing_attributes.sql) manually before deploying the matching frontend. The migration adds `dominant_color` and `clothing_type`, then copies the old `color` and `subcategory` values into the new columns only when those old columns exist and the new value is null. It does not rename or drop the old columns. It adds separate secondary color, color family, brightness, pattern, formality, occasion, and update timestamp columns. `NOT VALID` constraints preserve historical rows without validating their existing values and require non-empty context on new or updated rows. Confidence columns, if present, are removed because they are model metadata rather than wardrobe data. Existing notes, row IDs, image paths, and outfit links are preserved.

The migration does not parse or rewrite existing context values or notes. Historical rows with missing values remain unchanged because the new context constraints are `NOT VALID`; new and updated rows must satisfy them. The existing `image_path` uniqueness and outfit relationships remain unchanged. When one photo yields multiple clothing items, the app saves a separate copy of the reviewed photo under each item's unique Storage path and inserts one `clothing_items` row per item. This keeps deletion and outfits attached to individual wardrobe item IDs without adding a new image table. The migration is manual, is not run by the app, and must be confirmed on the target Supabase project before deploying the schema-dependent frontend.

## 3. Configure signup email behavior

In **Authentication → URL Configuration**, set the local Site URL to the active Vite origin (`http://localhost:5173` or `http://localhost:5174`) and add the production frontend URL before deployment. Configure email confirmation as desired. When confirmation is enabled, signup records the account/consent in Auth and the user must confirm their email before getting an authenticated session.

## 4. Configure local environment

Copy the root `.env.example` to `.env.local`; copy `backend/.env.example` to `backend/.env`. Replace `YOUR_PROJECT_ID` and `YOUR_PUBLISHABLE_KEY` with the values for your Supabase project in both files. Publishable keys are designed for browser use; never substitute a service-role/secret key. Keep both local environment files out of source control.

The API loads `backend/.env` automatically. Set `APP_ORIGINS` to comma-separated production/LAN origins as needed; local Vite origins `http://localhost:5173` and `http://localhost:5174` are allowed by the API. Then start:

```powershell
# Terminal 1 (project root)
npm install
npm run dev

# Terminal 2 (project root)
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --app-dir backend --reload
```

Restart Vite after changing `.env.local`, and restart FastAPI after changing `backend/.env`.

## 5. Data flow and verification

1. Signup sends name, age confirmation, terms/privacy acceptance, and their versions to Supabase Auth user metadata. The database trigger creates `profiles` and three consent rows.
2. Supabase Auth returns a session JWT. The React Supabase client attaches it to Postgres and Storage operations; RLS checks `auth.uid()` for every row/object. Avatar selection operations go through FastAPI with the same user JWT and rely on the existing owner-only profile RLS policy.
3. On clothing upload, the browser first sends the original file and user JWT to FastAPI. FastAPI validates the JWT through `/auth/v1/user` and temporarily runs Main 9 analysis; the AI returns every duplicate-filtered detection and does not create database records or upload to Storage. Unsupported images are rejected.
4. The user reviews and edits the AI fields for every detected item and provides any season/formality/occasion/notes. Only after confirming Save does FastAPI/Pillow rotate, resize, strip EXIF, and encode WebP; React uploads one copy per item to distinct private bucket paths and inserts one user-approved metadata row per item into `clothing_items`. The SQL check and RLS policy require the caller's UUID. If an upload or row insert fails, the frontend attempts to remove uploaded paths and reports a cleanup failure explicitly.
5. The frontend maps the saved `profiles.avatar_id` to a bundled illustration under `public/avatars/`. FastAPI accepts only the documented built-in IDs; no avatar image is uploaded or stored.
6. Clothes, outfits, profiles, and clothing photos are fetched only under the current user's session. Clothing photo display uses short-lived signed URLs. Main 9 processes only provisional clothing-analysis requests; AI suggestions are reviewed by the user and photos are not used to train models. No outfit recommendations are involved. Main 9's desktop-only Tkinter UI is optional and is not imported by headless FastAPI deployments.
7. Test two users: each should see/edit only their own rows, cannot read or delete the other's image, and cannot link the other's clothing into an outfit.

## 6. Built-in avatar API

- `GET /api/profile/avatar` returns `{"avatar_id":"fern"}` for the authenticated profile.
- `PUT /api/profile/avatar` accepts `{"avatar_id":"indigo"}`. FastAPI validates the ID against the bundled set, scopes the PostgREST update to the authenticated user's `profiles.id`, and returns the saved ID.
- No image or file upload is accepted by these avatar routes. The frontend resolves the ID to a local SVG asset.
- Errors use FastAPI's `{"detail":"..."}` shape. Invalid IDs return `422`; missing/expired authentication returns `401`; missing profile returns `404`; upstream database failures return `502`.

## 7. Avatar migration to run manually

The current avatar design keeps the selected built-in identifier on the existing `public.profiles` row. The five accepted values are `fern`, `terracotta`, `sage`, `indigo`, and `ochre`. The migration adds `avatar_id text`, backfills existing rows to `fern`, sets the default and non-null constraint, adds an allowlist check constraint, and grants the authenticated role permission to update that column. It does not create a profile-image table, Storage bucket, foreign key, or image upload path.

Run the complete migration in [`supabase/migrations/20260926_add_profiles_avatar_id.sql`](./supabase/migrations/20260926_add_profiles_avatar_id.sql) manually after checking the deployed schema. It is intentionally not executed by FastAPI or the frontend. Existing owner-only profile RLS remains the security boundary:

```sql
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id)
```

The migration preserves existing profile rows and does not replace the current `profiles` table. If an unexpected avatar column or unsupported existing values are present, stop and resolve those values/schema differences before running it.

## 8. Local API origins and avatar flow

`backend/APP_ORIGINS` may contain comma-separated production and LAN origins. FastAPI preserves those configured origins and also allows the local Vite origins `http://localhost:5173` and `http://localhost:5174`; it never uses `allow_origins=["*"]`. Restart FastAPI after changing the environment. The frontend calls `PUT http://localhost:8001/api/profile/avatar` with the Supabase access token and a JSON avatar identifier. FastAPI verifies the token through Supabase Auth, updates only the verified user's profile row through PostgREST, and returns the saved identifier.

The local preflight contract is covered by the backend test suite. Live database persistence, refresh/re-login behavior, and cross-user RLS isolation must still be tested with an authorized Supabase account.

The service-role key is neither required nor used. Keep `.env.local` and `backend/.env` out of source control. Review Supabase backups, region, email settings, retention, and India-specific legal/grievance obligations before real-user launch. The supplied legal copy is not legal advice or a compliance certification.
