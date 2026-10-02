# The Fold — Version 1

## Overview

Version 1 turns the previous manually catalogued wardrobe into an AI-assisted, human-reviewed digital wardrobe, while keeping The Fold's existing Supabase-backed accounts, wardrobe records, and individual-item outfit relationships. It adds Main 9 image analysis and a public entry page; it does not replace the application or make AI the authority over saved wardrobe data.

This history is based on the repository's `ca22769` V0 baseline, the commits after that baseline (`a1fa97f`, `8edc26a`, `017472d`, and `31b2c63`), the current source and SQL migrations, and local verification records. It distinguishes repository implementation from changes that still require manual configuration in Supabase or deployment dashboards.

## Previous Version → Version 1

### 1. Product & User Experience

- The previous version opened at account sign-in and relied on manual clothing details. V1 adds a public landing page at `/` with calls to the existing `/login` and `/signup` flows.
- The landing page explains the actual wardrobe, reviewed AI-assistance, and outfit capabilities without promising recommendations or other unimplemented features.
- The root app keeps the existing home, wardrobe, profile/account, and outfit experiences; it does not introduce a second application or router framework.
- Light/dark preference is persisted in browser storage. The V1 consistency pass carries it through public, auth, privacy, setup, loading, and recovery screens and applies the stored preference before the app bundle renders.
- Existing profile tools include profile editing, bundled avatar choice, data export, privacy information, and account controls. Their persistence still depends on the related manual migration and live Supabase setup.
- Responsive refinements cover the landing-page navigation and layout; existing mobile wardrobe/outfit UI remains in place.

### 2. AI Integration

- Main 9 was integrated into the existing FastAPI backend at authenticated `POST /api/images/analyze`; it is not a second backend or a paid hosted AI service.
- Inspection of bundled `best.pt` in the project interpreter reports an Ultralytics **YOLO26n-seg** model (scale `n`), task `segment`, and 13 labels. It is not YOLO26s.
- The checkpoint metadata identifies a training data path named `wardrobe_yolo/data.yaml`; it does not establish DeepFashion2 provenance. V1 documentation therefore does not claim DeepFashion2 as a verified training dataset.
- The inference call uses 416 image size, 0.5 confidence threshold, and agnostic NMS. Segmentation masks feed color extraction and heuristic pattern analysis.
- The existing same-class overlap/containment/split-garment duplicate filter remains in Main 9. The pipeline processes each retained detection and returns an array; it does not discard all but the first garment.
- The model classes map to Top, Bottom, Outerwear, and Dress categories. No shoe class or speculative material/brand/size/price field was added.
- AI-proposed wardrobe attributes are Clothing Type, Category, Dominant Color, Secondary Color, Color Family, Brightness, and Pattern. Confidence metadata is removed from the analysis API response and is not user-facing or stored as a wardrobe attribute.

### 3. Clothing Upload Workflow

V1 replaces the one-item manual-entry path with a temporary analysis and human review flow:

```text
Choose photo
→ authenticated temporary AI analysis
→ reject unsupported image or return every retained detection
→ user reviews and edits each detected item's AI fields
→ user explicitly selects Season, Formality, and Occasion per item
→ user confirms Save
→ image conversion and permanent Storage/Database writes
```

- One image can contain several genuine clothing items (for example, a T-shirt, trousers, and jacket). Distinct detections remain separate after duplicate filtering.
- The frontend renders an independent editable section for every returned item.
- **Season, Formality, and Occasion are not inferred by AI.** They start blank and are required user selections for each detected item. Note is optional user-authored free text.
- The AI does not write directly to wardrobe storage. Unsupported images, analysis errors, and cancellation before Save do not create permanent wardrobe items.
- On Save, the selected photo is compressed to WebP and a separate object path and wardrobe row are created for each verified item. Partial-failure handling attempts removal of newly uploaded objects and reports cleanup errors.

### 4. Data & Database Changes

- The in-place `20261002_add_structured_ai_clothing_attributes.sql` migration adds `dominant_color`, `clothing_type`, `secondary_color`, `color_family`, `brightness`, `pattern`, `formality`, `occasion`, and `updated_at` where absent.
- If legacy `color` or `subcategory` columns exist, the migration copies their values into the new columns when those new values are null. It does not rename or drop the legacy columns.
- Existing notes are not parsed or rewritten. Existing row IDs, image paths, and outfit references are preserved.
- Season was already part of the base schema; the migration adds non-empty Season/Formality/Occasion checks as `NOT VALID`, so old rows are not validated or backfilled but new/updated rows must satisfy the checks.
- If present, `pattern_confidence` and `detection_confidence` columns are dropped as part of the migration; the application does not add or persist those values.
- `updated_at` is maintained by a database trigger.
- The `20260926_add_profiles_avatar_id.sql` migration adds the selected built-in avatar ID to existing profiles without storing image bytes.
- Migrations are manual. The repository does not establish that either migration has been applied to the currently configured live Supabase project; confirm the live schema before deploying schema-dependent code.

### 5. Authentication

- V1 keeps the existing Supabase Auth implementation and adds public routing around it rather than introducing another auth provider or account system.
- The landing actions open existing Login and Sign Up modes. A valid session continues into the app; an authenticated visitor opening `/login` or `/signup` is redirected to `/`.
- Browser back/forward updates public routes. Logout returns to the public landing page.
- Signup still collects name, age confirmation, and terms/privacy acknowledgement and handles Supabase's possible email-confirmation response. Whether confirmation is enabled is a project-level deployment setting and has not been verified from this repository.
- There is no in-app forgot-password or reset-password workflow in V1.
- Theme preference survives landing → auth → app and refresh; unauthenticated privacy and loading states use the same theme.

### 6. Outfit Management

- V1 does not redesign the outfit workflow or data model.
- Outfits continue to use ordered `outfit_items` links to individual clothing row IDs, so separate detections from one uploaded photo remain individually available.
- Outfit editing, removal, drag/drop and saved-outfit behavior stay on the existing implementation. Local workflow changes preserve compatibility; live Supabase persistence still needs authorized end-to-end testing.

### 7. UI/Design System

- Added a public landing page using the existing brand mark, palette, typography, buttons, and theme tokens.
- Added a responsive public navigation menu and mobile/desktop landing layouts.
- Unified dark-theme tokens across public pages, auth, privacy/legal views, setup errors, and loading/recovery surfaces; added an early theme initialization to reduce light-mode flashes.
- Added editable multi-item AI review and a final review-before-save step while preserving the existing product UI patterns.
- Improved touch-sized interactions, form validation, item cards, and modal behavior during earlier V1 AI/upload work, without redesigning the outfit product.

### 8. Deployment & Infrastructure

- V1 retains the existing React/Vite → FastAPI → Supabase architecture.
- Main 9 is loaded in the existing backend and does not require a GPU; no GPU dependency or external paid inference API was introduced. The deployed runtime hardware has not been verified.
- The frontend deployment arrangement is Netlify; `public/_redirects` sends public deep links through the SPA entry point. The backend deployment arrangement is Render. Supabase continues to provide Auth, Postgres, and Storage.
- The repository does not include declarative Netlify/Render service manifests; live provider settings, origins, and production service health are not proven by the source tree.
- FastAPI validates user JWTs before protected analysis, image compression, and avatar operations. The frontend uses publishable Supabase configuration and relies on RLS; no service-role key is required in the browser.
- A local API-port correction and local CORS fixes are present in history before the V1 branch baseline; they are part of the prior V0 state, not new V1 milestones.

### 9. Documentation

- Reworked the README around current product behavior, verified technologies, setup, AI limitations, and deployment/live-check caveats.
- Replaced the speculative AI blueprint with a current Main 9 integration guide.
- Reworked the project plan into a current-state and verification document.
- Corrected Supabase setup text to match the actual migration behavior, manual application requirement, and placeholder environment files.
- Added this permanent V1 history document.

### 10. Bug Fixes

- Fixed the integration path that previously used only the first item from a multi-detection response: all returned items are now independently reviewed and saved.
- Retained Main 9 duplicate filtering while processing every distinct retained detection.
- Removed confidence values from user-facing/API wardrobe data, exports, and the schema migration.
- Prevented a theme mismatch and light background flash when moving from the landing page to authentication, and themed public privacy plus setup/loading/recovery screens.
- Corrected schema documentation that inaccurately said the migration renamed legacy columns and backfilled context values. The SQL actually copies selected legacy values and leaves missing historical context untouched.
- Replaced tracked `.env.example` project values with placeholders so copied setup files do not disclose deployment-specific settings.
- V1 testing history also records local fixes for model path/temp-file handling and headless Tkinter imports; those changes are retained in the existing Main 9 integration code.

## Before Version 1

The V0 baseline already had a Supabase-backed account and wardrobe, manual item entry, a profile/account area, and an outfit builder. Its README explicitly described clothing details as manually entered and stated that there was no AI clothing recognition. The main application and outfit system were established product surfaces; V1 did not rebuild them.

## After Version 1

The Fold has a public landing/auth entry flow and Main 9-assisted, multi-item photo intake with item-by-item user verification. The established Supabase-backed wardrobe and outfit model remain the destination for user-approved data. Local code and mock/API tests can be checked from this repository, but live schema, bucket configuration, provider deployment, and authenticated user flows still require confirmation in the actual configured services.

## Major V1 Milestones

1. **Main 9 added to the existing FastAPI app** (`a1fa97f`): model pipeline, dependencies, checkpoint, and first integrated analysis route.
2. **Analysis workflow enabled** (`8edc26a`): API/UI integration, temporary analysis, structured schema evolution, and multi-item review work.
3. **AI workflow tightened** (`017472d`): preserve reviewed multi-detection results, remove confidence from user-facing wardrobe data, require per-item manual context, and refine migration handling.
4. **Public landing added** (`31b2c63`): landing, public route wiring, and Netlify SPA fallback.
5. **V1 consistency/history pass**: share theme across public/auth/loading states, correct documentation to source behavior, replace config example values with placeholders, and record this version history.

## Current V1 Capabilities

- Public landing, Login, Sign Up, and Privacy entry pages.
- Supabase Auth-based sign-in/sign-up and existing signed-in app screens.
- Persisted light and dark preference across refresh and public/auth views.
- Clothing upload, authenticated temporary Main 9 analysis, unsupported-image rejection, and multiple-item detection review.
- Editable AI-generated fields and required manual Season, Formality, and Occasion per item.
- User-confirmed per-item image and wardrobe-row writes; editing, search, category filters, deletion, profile tools, and data export.
- Existing outfit creation/edit/display based on individual clothing IDs.
- Built-in avatar selection and technical privacy/terms UI.

## Known Limitations

- Main 9 supports 13 classes only; it does not detect shoes.
- Some Indian ethnic clothing may be less reliably detected; pattern output is heuristic.
- The bundled checkpoint is YOLO26n-seg, not YOLO26s. Its metadata does not prove DeepFashion2 training.
- Supabase email-confirmation state and actual Netlify/Render dashboard configuration are not verifiable from this repository.
- The structured clothing and avatar SQL migrations require manual application; the live schema state is unconfirmed.
- A previous live upload test was blocked because Supabase Storage rejected WebP. Confirm the private bucket allows `image/webp` before treating live saves as ready.
- Live multi-item saves, user-to-user RLS isolation, outfit persistence, account deletion, and refresh/re-login still require an authorized deployed Supabase test account.
- There is no in-app forgot/reset-password flow.

## Deferred to Future Versions

V1 does not include outfit recommendations, trend prediction, fabric/material, brand, size, price or garment-measurement inference, shoe detection, an additional AI provider, password recovery UI, a new outfit workflow, or a separate uploaded-image database model.
