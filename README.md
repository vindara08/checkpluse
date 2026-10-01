# The Fold: Digital Wardrobe V0

A personal clothing catalogue and outfit builder. Main 9 suggests clothing attributes from a temporarily processed upload; the account holder reviews and edits those suggestions before saving. There are no outfit recommendations, advertising, or analytics.

See [DIGITAL_WARDROBE_PLAN.md](./DIGITAL_WARDROBE_PLAN.md) for the end-to-end product plan, current implementation status, and remaining live-upload verification steps.

## Stack and data flow

- React + Vite with Supabase Auth and the Supabase publishable key.
- Supabase Postgres for profiles, consent records, clothing metadata, outfits, and outfit items. Row Level Security (RLS) scopes data to each signed-in user.
- Private Supabase Storage bucket for compressed WebP photos, with ownership enforced by Storage RLS policies.
- FastAPI validates Supabase access tokens, temporarily analyzes clothing photos with Main 9, and compresses images only after the user reviews the suggestions. Avatar images are bundled with the frontend; only the selected avatar ID is stored in the profile.

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

The browser first sends the selected image and session token to FastAPI for temporary Main 9 analysis. Main 9 uses the bundled `best.pt` weights, YOLO detection and segmentation, duplicate filtering, and color/pattern analysis, returning one structured suggestion for every distinct detection. Unsupported images are rejected without a permanent upload or database row. The user reviews and can correct every AI field, then must explicitly select season, formality, and occasion for each item; notes are optional. Confidence scores are internal model metadata and are not returned to the wardrobe UI, exported, or stored in clothing records. Only after confirmation does Pillow reorient, resize to at most 1600 px, composite transparent pixels onto white, convert to WebP, and strip EXIF metadata. Each reviewed clothing item receives its own row and unique private Storage path (a copy of the selected image), preserving individual IDs for outfit references and independent deletion. The desktop prototype's Tkinter UI is optional and does not prevent headless FastAPI/Render imports. Built-in avatars are frontend assets; `profiles.avatar_id` stores only the selected stable ID, never image bytes. No avatar Storage bucket or upload is used.

For an existing Supabase deployment, review and manually apply [`supabase/migrations/20261002_add_structured_ai_clothing_attributes.sql`](./supabase/migrations/20261002_add_structured_ai_clothing_attributes.sql) before deploying the updated frontend. It renames the old `color` and `subcategory` columns in place, adds structured Main 9 attributes and user context, preserves existing notes and outfit links, and does not drop existing rows. New installations should use the updated schema in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

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
