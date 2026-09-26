# The Fold: Digital Wardrobe V0

A personal clothing catalogue and outfit builder. No AI clothing recognition, recommendations, advertising, or analytics. Clothing details are entered by the account holder.

See [DIGITAL_WARDROBE_PLAN.md](./DIGITAL_WARDROBE_PLAN.md) for the end-to-end product plan, current implementation status, and remaining live-upload verification steps.

## Stack and data flow

- React + Vite with Supabase Auth and the Supabase publishable key.
- Supabase Postgres for profiles, consent records, clothing metadata, outfits, and outfit items. Row Level Security (RLS) scopes data to each signed-in user.
- Private Supabase Storage bucket for compressed WebP photos, with ownership enforced by Storage RLS policies.
- FastAPI validates Supabase access tokens for profile avatar selection and compresses clothing images. Avatar images are bundled with the frontend; only the selected avatar ID is stored in the profile.

The publishable key is safe to include in the frontend only because RLS policies are enabled. A Supabase service-role key is not used and must never be put in the browser.
This storage redesign uses Supabase Auth instead of the previous local SQLite account/session store. Existing SQLite accounts and wardrobe records are not automatically imported; retain a protected backup before switching.

## Run locally

1. Install Node.js 20.19+ and Python 3.12+.
2. Follow [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) to create a Supabase project, the private `wardrobe-images` bucket, tables, signup trigger, and RLS policies. After reviewing the deployed schema, apply [20260926_add_profiles_avatar_id.sql](./supabase/migrations/20260926_add_profiles_avatar_id.sql) to enable built-in avatar selection.
3. Copy `.env.example` to `.env.local` and `backend/.env.example` to `backend/.env`. Put the Supabase project URL and publishable key in both files. These are publishable project settings; no secret key is required. Set the frontend origin in backend `APP_ORIGINS`.
4. Start the frontend:

   ```powershell
   npm install
   npm run dev
   ```

5. In a second terminal, start FastAPI:

   ```powershell
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   python -m uvicorn main:app --app-dir backend --reload
   ```

6. Open the Vite URL shown in the terminal. Restart Vite after changing `.env.local` and FastAPI after changing `backend/.env`.

## Image flow

Pillow reorients clothing photos, resizes to at most 1600 px, composites transparent pixels onto white, converts to WebP, and strips EXIF metadata. FastAPI checks the Supabase Auth token before processing. The browser uploads the resulting WebP to the user's UUID folder in the private Storage bucket, then writes metadata and the object path to `clothing_items`. Built-in avatars are frontend assets; `profiles.avatar_id` stores only the selected stable ID, never image bytes. No avatar Storage bucket or upload is used.

The bundled avatar IDs map to `public/avatars/fold-fern.svg` (`fern`), `fold-terracotta.svg` (`terracotta`), `fold-sage.svg` (`sage`), `fold-indigo.svg` (`indigo`), and `fold-ochre.svg` (`ochre`). Keep these identifiers aligned with the database check constraint and FastAPI allowlist.

## Privacy and launch readiness

RLS and Storage policies are mandatory; never make the bucket public or disable RLS. Signup captures age confirmation and terms/privacy versions. Review region, authentication email settings, retention/backups, grievance contact, and current India DPDP obligations with qualified counsel before real users. Legal copy in the app is a technical starter, not legal advice or a compliance certification.

## Checks

```powershell
npm run lint
npm run build
.\.venv\Scripts\python.exe -m pytest -q
```

## Current avatar status

The app uses five bundled, selectable avatars: `fern`, `terracotta`, `sage`, `indigo`, and `ochre`. The browser sends the selected identifier to FastAPI at `PUT /api/profile/avatar`; FastAPI validates the identifier and updates the authenticated user's existing `profiles.avatar_id` value through Supabase. No profile image upload or avatar Storage bucket is used.

Local development CORS allows both `http://localhost:5173` and `http://localhost:5174`, in addition to any origins listed in `backend/.env`. The avatar request has a bounded 10-second timeout and reports backend errors to the user. Run the manual avatar migration in `supabase/migrations/20260926_add_profiles_avatar_id.sql` only after reviewing the deployed schema and RLS policies; SQL is not executed by the application.

The CORS/preflight and frontend/backend contract are covered by local tests. Persistence through the actual Supabase project, refresh/re-login behavior, and two-user RLS verification still require an authorized live test account.
