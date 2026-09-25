# The Fold: Digital Wardrobe V0

A personal clothing catalogue and outfit builder. No AI clothing recognition, recommendations, advertising, or analytics. Clothing details are entered by the account holder.

See [DIGITAL_WARDROBE_PLAN.md](./DIGITAL_WARDROBE_PLAN.md) for the end-to-end product plan, current implementation status, and remaining live-upload verification steps.

## Stack and data flow

- React + Vite with Supabase Auth and the Supabase publishable key.
- Supabase Postgres for profiles, consent records, clothing metadata, outfits, and outfit items. Row Level Security (RLS) scopes data to each signed-in user.
- Private Supabase Storage bucket for compressed WebP photos, with ownership enforced by Storage RLS policies.
- FastAPI + Pillow validates the Supabase access token and compresses images. The browser uploads the resulting WebP directly to Supabase with that user's JWT.

The publishable key is safe to include in the frontend only because RLS policies are enabled. A Supabase service-role key is not used and must never be put in the browser.
This storage redesign uses Supabase Auth instead of the previous local SQLite account/session store. Existing SQLite accounts and wardrobe records are not automatically imported; retain a protected backup before switching.

## Run locally

1. Install Node.js 20.19+ and Python 3.12+.
2. Follow [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) to create a Supabase project, the private `wardrobe-images` bucket, tables, signup trigger, and RLS policies.
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

Pillow reorients, resizes to at most 1600 px, composites transparent pixels onto white, converts to WebP, and strips EXIF metadata. FastAPI checks the Supabase Auth token before processing. The React client uploads the compressed image to the user's UUID folder in the private Storage bucket, then writes metadata and the object path to Supabase Postgres. The original photo and image bytes are not stored in a database table.

## Privacy and launch readiness

RLS and Storage policies are mandatory; never make the bucket public or disable RLS. Signup captures age confirmation and terms/privacy versions. Review region, authentication email settings, retention/backups, grievance contact, and current India DPDP obligations with qualified counsel before real users. Legal copy in the app is a technical starter, not legal advice or a compliance certification.

## Checks

```powershell
npm run lint
npm run build
.\.venv\Scripts\python.exe -m pytest -q
```
