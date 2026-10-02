# The Fold — Digital Wardrobe

The Fold helps people organize clothing they own, review photo-based clothing suggestions, and make saved outfits from individual wardrobe items.

## Current capabilities

- Public landing page, login, and signup entry points using the existing Supabase Auth flow.
- Light and dark themes persisted in the browser and carried between public, authentication, and signed-in views.
- A personal wardrobe with photo upload, search, category filters, item editing/deletion, profile tools, and data export.
- Main 9 analyzes a temporary image and returns every supported, duplicate-filtered clothing detection. Users review and may edit AI fields before any permanent upload or database insert.
- Each accepted detection is saved as its own clothing row and private image object. Outfits continue to reference individual clothing-row IDs.
- Outfit builder with tap/drag-to-canvas, naming, and saved outfit editing.
- Privacy and terms pages, age/terms/privacy acknowledgement on signup, consent records, and account deletion controls.

## Technology and deployment

- **Frontend:** React 19, Vite 8, JavaScript, and `@supabase/supabase-js`.
- **Backend:** Python 3.12, FastAPI, Uvicorn, Pillow, and HTTPX.
- **Database/auth/storage:** Supabase Auth, Supabase Postgres, and Supabase Storage, protected by user sessions and Row Level Security (RLS).
- **Image analysis:** Main 9, Ultralytics YOLO26 instance segmentation, OpenCV, NumPy, and scikit-learn. The bundled checkpoint is `best.pt`.
- **Deployment arrangement:** Netlify for the Vite frontend, Render for the FastAPI service, and Supabase for database, authentication, and storage. The repository has a Netlify SPA rewrite but no declarative Netlify or Render service configuration; deployed dashboard settings and production health have not been independently verified here.

### Verified checkpoint identity

The bundled `best.pt` checkpoint was loaded from the workspace and reports a **YOLO26n-seg** model with 13 class labels. It is not YOLO26s. Its training metadata refers to a local `wardrobe_yolo/data.yaml` path and does not establish that the training dataset was DeepFashion2. For that reason, this project does not claim YOLO26s or DeepFashion2 as verified implementation facts.

The 13 supported labels are `short_sleeve_top`, `long_sleeve_top`, `short_sleeve_outwear`, `long_sleeve_outwear`, `vest`, `sling`, `shorts`, `trousers`, `skirt`, `short_sleeve_dress`, `long_sleeve_dress`, `vest_dress`, and `sling_dress`. Shoes are not a model class.

## AI data and review flow

AI suggestions are clothing type, category, dominant color, secondary color, color family, brightness, and pattern. Main 9 uses instance masks, duplicate filtering, color extraction, and heuristic pattern analysis. It returns all remaining detections, not only the first.

Season, Formality, and Occasion are **not inferred by AI**. The user must explicitly choose each of these fields for every detected item before saving. Note is optional free text. Confidence values remain internal AI information and are not user-facing wardrobe attributes or persisted clothing columns.

```text
Select photo → temporary analysis → review each detection → correct AI fields
→ choose Season, Formality, Occasion for each item → Save
→ private Storage objects + individual Supabase clothing rows
```

Unsupported/non-clothing images are rejected by analysis and are not permanently uploaded or saved as clothing rows. Cancelling before Save also produces no permanent write.

### Known AI limitations

- Only the 13 classes listed above are supported; shoes are not detected.
- Detection reliability depends on the image and garment presentation. Some Indian ethnic clothing may be detected less reliably.
- Pattern classification is heuristic; it is not a dedicated trained fashion-attribute model.
- AI suggestions should be reviewed and corrected by the user.
- The checkpoint's provenance does not confirm DeepFashion2; no dataset claim is made.

See [ai service.md](./ai%20service.md) for the implementation-level analysis notes and [VERSION_1.md](./VERSION_1.md) for the V1 history.

## Database and migrations

The base schema, signup trigger, RLS policies, private bucket setup, and verification instructions are in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md). Existing installations may need the manual migrations:

- [`20260926_add_profiles_avatar_id.sql`](./supabase/migrations/20260926_add_profiles_avatar_id.sql) adds the bundled-avatar identifier to profiles.
- [`20261002_add_structured_ai_clothing_attributes.sql`](./supabase/migrations/20261002_add_structured_ai_clothing_attributes.sql) adds structured Main 9 fields, copies legacy `color`/`subcategory` values when those columns exist, preserves notes and outfit IDs, adds context checks for new/updated rows, and drops legacy confidence columns if present.

These SQL files are not executed by the app. Repository history records that the structured migration still required manual application to the configured Supabase deployment; deployment state must be checked before releasing this frontend. Never make the image bucket public or disable RLS.

## Local development

Requirements: Node.js 20.19+ and Python 3.12+. Install the frontend dependencies with `npm install`, and backend dependencies with `pip install -r requirements.txt`. Keep `best.pt` beside `main9.py`.

1. Follow [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) to create/check the Supabase schema, policies, private `wardrobe-images` bucket, and allowed WebP MIME type.
2. Copy `.env.example` to `.env.local` and `backend/.env.example` to `backend/.env`. Use the Supabase project URL and publishable key placeholders. Do not put a service-role/secret key in frontend configuration.
3. Start the frontend:

   ```powershell
   npm run dev
   ```

4. Start the backend in another terminal:

   ```powershell
   .\.venv\Scripts\Activate.ps1
   python -m uvicorn main:app --app-dir backend --reload
   ```

The local API defaults to `http://localhost:8001/api`. Set `VITE_API_URL` for the deployed API and configure the backend `APP_ORIGINS` with the real frontend origins. Restart each process after changing its environment.

## Authentication, privacy, and operational status

Supabase Auth manages passwords and sessions. Signup requires a name, age confirmation, and acknowledgement of the Terms and Privacy notice. Whether Supabase email confirmation is required depends on the project-level Auth configuration; that deployed setting is not established by this repository. There is no in-app forgot-password or reset-password flow.

The browser uses only a Supabase publishable key; RLS and Storage policies must enforce user ownership. FastAPI verifies the user's Supabase access token before protected image analysis, compression, and avatar operations. Analysis is temporary. On Save, FastAPI/Pillow reorients, bounds, converts to WebP, and strips embedded metadata; React uploads private per-item object paths and inserts metadata rows. The app does not use an AI provider API, advertising, or analytics.

The legal pages are implementation copy, not legal advice or a compliance certification. Confirm real retention, email, complaint-contact, regional, and applicable legal settings with the operator before launch.

## Checks

```powershell
npm run lint
npm run build
.\.venv\Scripts\python.exe -m pytest -q
```

The checked-in backend tests are local contract/unit tests. Live Supabase persistence, deployment configuration, cross-user RLS, and end-to-end authenticated uploads require an authorized deployed test account and are not claimed as verified by these commands.
