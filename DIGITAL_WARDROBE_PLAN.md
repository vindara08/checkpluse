# The Fold — Current Project Status

Last checked: 2 October 2026

This document describes the implemented V1 application and the checks still required against the actual deployed services. It is not a roadmap of unimplemented features.

## Product

The Fold is a personal digital wardrobe. A user can catalog clothing, get provisional Main 9 attribute suggestions from a photo, review and edit the results, and save outfits that reference individual clothing items.

## Implemented architecture

- **Web app:** React + Vite. Public landing, login/signup, signed-in wardrobe, profile, privacy/terms, and outfit UI share one frontend.
- **Backend:** FastAPI/Python serves authenticated photo analysis, image conversion, and built-in avatar selection.
- **Identity/data:** Supabase Auth, Supabase Postgres, and Supabase Storage. Client database/storage operations use user sessions and depend on correctly configured RLS policies.
- **AI:** Main 9 loads the bundled YOLO26n-seg checkpoint `best.pt`, performs instance segmentation, duplicate filtering, color analysis, and heuristic pattern classification.
- **Deployment arrangement:** Netlify frontend, Render backend, Supabase services are the intended deployment arrangement. The repository does not include declarative host configurations; inspect provider dashboards/environment settings to confirm live deployment state.

## Current workflows

### Sign-in and account

Public routes are `/`, `/login`, `/signup`, and `/privacy`. Login/signup use the existing Supabase Auth component. A session discovered during startup opens the app; login/signup links do not create a second authentication system. Light/dark mode is browser-persisted.

Signup asks for name, age confirmation, Terms acceptance, and acknowledgement of the Privacy notice. Email confirmation behavior is a Supabase project setting, and its current live value has not been verified. There is no in-app forgot/reset-password flow.

The signed-in UI provides home, wardrobe, outfits, profile/account controls, avatar selection, privacy/terms, export, and account deletion. Outfits reference individual clothing row IDs; there was no V1 redesign of the outfit relationship model.

### Clothing photo analysis and save

1. The browser sends a selected image and current Supabase session to authenticated FastAPI `POST /api/images/analyze`.
2. FastAPI validates the session and passes a temporary file to Main 9. Analysis does not upload a permanent image or insert a wardrobe row.
3. Main 9 returns all supported detections after duplicate filtering, or rejects unsupported images. A single photo may contain multiple distinct garments.
4. The user reviews and can edit each item's AI fields.
5. The user explicitly selects Season, Formality, and Occasion for **each** item. AI does not infer these fields. Note is optional.
6. Only when the user confirms Save does FastAPI/Pillow prepare a WebP. The browser uploads one private Storage object and inserts one clothing row per item; each wardrobe item has its own row ID and image path.
7. Cancellation or analysis rejection does not create permanent wardrobe data. The frontend attempts cleanup if a multi-item save partially fails.

### AI attributes and limitations

AI-proposed fields: clothing type, category, dominant color, secondary color, color family, brightness, and pattern. Confidence metadata is not shown to users or stored as a wardrobe attribute.

The bundled checkpoint was inspected from the workspace: it identifies as YOLO26n-seg (nano), task `segment`, with 13 labels. It is **not YOLO26s**. Checkpoint training metadata refers to a local `wardrobe_yolo/data.yaml` and does not establish DeepFashion2 as the training dataset. Do not present either YOLO26s or DeepFashion2 as verified project facts.

The supported labels are:

`short_sleeve_top`, `long_sleeve_top`, `short_sleeve_outwear`, `long_sleeve_outwear`, `vest`, `sling`, `shorts`, `trousers`, `skirt`, `short_sleeve_dress`, `long_sleeve_dress`, `vest_dress`, `sling_dress`.

No shoe class exists. Some Indian ethnic clothing may be less reliably detected. Pattern analysis is heuristic rather than a trained fashion-attribute classifier. AI predictions need human review.

## Database and migrations

Supabase schema and policies are documented in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md). SQL migrations are manual and are not run by the frontend or backend:

- `20260926_add_profiles_avatar_id.sql` adds the stable built-in avatar ID to `profiles`.
- `20261002_add_structured_ai_clothing_attributes.sql` adds structured color/type/pattern/context fields and `updated_at`; copies legacy `color` to `dominant_color` and `subcategory` to `clothing_type` when present; preserves notes, row IDs, and outfit links; adds NOT VALID context constraints; removes confidence columns if present.

The structured migration has not been confirmed as applied to the configured live Supabase project. The repository history and prior local/live testing recorded required manual database and Storage setup before a production wardrobe save can be considered verified.

## Security and deployment checks

- Keep the Storage bucket private and allow WebP uploads.
- Keep RLS active on tables and Storage objects, with user ownership enforced.
- Use only the Supabase publishable key in the frontend; never use a service-role key in browser configuration.
- Configure backend `APP_ORIGINS` with the actual frontend hosts. Local Vite ports 5173 and 5174 are allowed in source.
- Set the production `VITE_API_URL` to the deployed FastAPI origin.
- Confirm Render/Netlify/Supabase dashboard settings, email behavior, schema/migrations, private bucket policy, and user-scoped reads/writes before release.

## Local verification and unverified live behavior

The repository provides `npm run lint`, `npm run build`, and `pytest` tests under `backend/`. These validate local source/build and mocked API contracts. They do not prove live Supabase persistence, provider deployment health, production email confirmation behavior, or cross-user RLS isolation.

Live browser testing requires an authorized Supabase account. Verify the complete analysis → human review → multi-item save → reload and outfit linkage flow after applying the structured migration and confirming WebP is allowed by the private bucket.

## Out of scope for this version

There is no outfit recommendation engine, external paid AI API, shoe detection, in-app password recovery, fabric/material inference, brand/size/price inference, or new image-sharing system.
