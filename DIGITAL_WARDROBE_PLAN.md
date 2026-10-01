# The Fold — Digital Wardrobe V0 Plan

Last updated: 2 October 2026

## Product goal

Build a private personal wardrobe catalogue. A user can create an account, add clothing with a photo, review and edit AI-suggested attributes alongside manual details, filter pieces by category, and save outfits made from their own pieces.

### Out of scope

- Outfit recommendations or other recommendation algorithms
- Public image access, ads, or analytics
- Unnecessary frameworks or unrelated features

## Current architecture

The initial brief mentioned SQLite, but the current implementation uses Supabase Auth and Supabase Postgres, with Row Level Security (RLS). This reflects the previously selected Supabase publishable-key design.

- **Frontend:** React + Vite
- **Authentication:** Supabase Auth; passwords are not stored by this application
- **Wardrobe metadata:** Supabase Postgres with owner-scoped RLS
- **Photos:** Private Supabase Storage bucket named `wardrobe-images`
- **Image processing:** FastAPI + Pillow; the browser sends the selected photo to the API, which checks the caller's Supabase session and returns a resized, metadata-stripped WebP
- **Provisional image analysis:** FastAPI invokes Main 9 on a temporary image file; detected clothing attributes are returned to the user for review and are not saved by the AI
- **Outfit data:** Postgres outfit records and ordered references to the user's clothing

The browser publishable key is not a substitute for RLS. Never expose a Supabase secret/service-role key in the frontend, source code, or this plan.

## User flow

1. Sign up with name, email, and password.
2. Read and accept the terms and privacy notice, and confirm the age requirement.
3. Sign in and open the wardrobe.
4. Select or take a clothing photo and request temporary Main 9 analysis.
5. Review every duplicate-filtered detection independently and correct all AI fields; enter season, formality, occasion, and optional notes for each piece.
6. After the user confirms Save, process the photo through FastAPI/Pillow and upload the compressed WebP to the private Storage bucket under the signed-in user's UUID.
7. Save one user-approved metadata row and unique Storage object path per detected piece in Postgres.
8. View, filter, or remove clothing; use pieces in the drag-and-drop outfit builder and save outfits.

## Delivery plan and status

### 1. Supabase and local setup

- [x] Provide database schema, signup bootstrap, RLS policies, private bucket instructions, and local environment guidance in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).
- [x] Keep publishable configuration separate from server-only configuration; do not put secrets in the frontend.
- [ ] Confirm the deployed bucket is private, then validate policies against a real signed-in account. An unauthenticated lookup reports `Bucket not found`, which does not prove whether the private bucket is absent or simply hidden from an unauthenticated caller.
- [x] Configure the local FastAPI process's Supabase URL and publishable key in its server environment, using only the publishable key.
- [ ] In Supabase Storage bucket `wardrobe-images`, allow `image/webp` while keeping the bucket private. A real upload attempt confirmed WebP is currently rejected.

### 2. Signup, sign-in, and profile

- [x] Provide Supabase Auth signup/sign-in, required name, age confirmation, terms/privacy acknowledgement, and a profile page.
- [x] Record consent versions through the database signup trigger.
- [ ] Verify account creation, email confirmation, sign-in, and profile updates in the configured Supabase project.

### 3. Clothing and photo upload

- [x] Integrate Main 9 analysis before save; the AI is provisional and cannot write to Storage or Postgres.
- [x] Review/edit all detections and structured Main 9 attributes; preserve individual clothing IDs for outfits.
- [x] Provide image compression, private object upload, signed image reads, and category filters.
- [ ] Review and manually apply the structured wardrobe migration to the configured Supabase project before deploying this frontend.
- [x] Enforce image type/size/dimension limits, remove EXIF metadata, and composite transparent pixels onto white.
- [x] Correct the local Vite API URL to the running image API on port `8001` after finding the old port `8000` route returned 404.
- [x] Configure and verify FastAPI CORS for the local frontend origins, `http://localhost:5173` and `http://localhost:5174`.
- [ ] After allowing WebP, complete a signed-in, end-to-end upload and confirm both the private Storage object and its matching Postgres row.
- [ ] Verify deletion removes the metadata and corresponding Storage object in the live project.

### 4. Outfit builder

- [x] Provide drag-and-drop and tap-to-add controls, duplicate prevention, outfit naming, and saved outfit display.
- [ ] Verify saving and reloading an outfit against the configured Postgres schema and RLS policies.

### 5. Privacy and account controls

- [x] Provide a privacy notice, consent records, profile editing, data export, and account deletion controls.
- [ ] Confirm the deployment's privacy contact, retention/backups, email settings, and current India DPDP obligations with the operator and qualified counsel before launch.

### 6. Quality checks

- [x] Backend tests, Python compilation, frontend lint, and production build pass in the local workspace (see verification below).
- [ ] Run the authenticated browser flow and live Supabase integration checks after an authorized test account is available.

## Multi-item photo upload acceptance checklist

Each item is verified only when all of the following succeed for a signed-in test user:

1. The browser reaches the configured FastAPI `/api/images/compress` endpoint.
2. The API validates the Supabase access token and returns `image/webp`.
3. The user reviews and confirms every item; cancellation or AI rejection makes no permanent write.
4. For each confirmed item, the browser uploads the WebP to a distinct `wardrobe-images/<user-uuid>/<random-id>.webp` path.
5. The browser inserts one clothing row per confirmed item, preserving all structured attributes and the user's verified edits.
6. The wardrobe reloads each row and displays its image using a signed URL.
7. Outfit records continue to reference individual clothing row IDs.
8. Another user cannot read or delete that object's path.
9. Removing the clothing item also removes its private Storage object.

## Verification performed on 26 September 2026

- The frontend is configured with a Supabase URL and publishable-key-shaped value; the Supabase Auth health endpoint returned **200**.
- The browser loaded the sign-in page, but no signed-in session was available.
- Before the local API URL correction, the frontend's configured image endpoint at port `8000` returned **404** for `/api/images/compress`. The running FastAPI image route at port `8001` returned **401** without a session, as expected.
- A browser request initially hit a CORS failure because the active API allowed a different local origin. The local API environment was configured for `http://localhost:5173`, and the API was restarted.
- The local Vite environment setting is now `http://localhost:8001/api`. A browser request from `http://localhost:5173` now reaches the correct API and receives **401 Sign in to upload a photo** rather than a CORS error or 404.
- A signed-in browser upload was then reproduced: FastAPI image compression returned **200**, but Supabase Storage rejected the WebP object with **400 `mime type image/webp is not supported`**. This is the current direct cause of the upload failure. The bucket's allowed MIME types must include `image/webp`; setup instructions and the user-facing error are updated accordingly.
- A read-only Storage bucket lookup without a signed-in session returned **Bucket not found** for `wardrobe-images`. Since the bucket is meant to be private, that unauthenticated response is inconclusive: the bucket may be absent or its metadata may not be visible to this caller. Confirm in the Supabase Dashboard or with an authorized test session.
- **A successful authenticated image upload is not yet verified.** The Storage upload was tested while signed in but rejected because WebP is not allowed by the bucket. The bucket configuration cannot be changed with the app's publishable key. After an authorized project administrator enables WebP, retry the test and confirm both the Storage object and database row.
- Local `backend/.env` now contains only the Supabase URL, publishable key, bucket name, and allowed frontend origin; no service-role/secret key was added. This configures the image API, but does not establish that the bucket/schema/policies are provisioned in the remote Supabase project.
- Earlier automated checks: **9 backend tests passed**, Python compilation passed, frontend lint passed, production build passed with a temporary 512 MB Node heap, and editor diagnostics reported no errors. The build heap setting was only for that validation command.

## Avatar transport update — 26 September 2026

The built-in avatar transport issue was traced to CORS configuration rather than a new profile system. The frontend sends `PUT /api/profile/avatar` with JSON `{ "avatar_id": "fern" }`, an `Authorization` bearer token, and `Content-Type: application/json`. That request requires a preflight. The backend origin list did not reliably include the active Vite origin `http://localhost:5174` in every local launch configuration, so the preflight was rejected before the endpoint ran. FastAPI now preserves configured origins and explicitly allows the two local Vite origins `http://localhost:5173` and `http://localhost:5174`; the frontend example configuration documents both. The avatar request also has a bounded 10-second timeout with a useful failure message.

Local verification now confirms the `OPTIONS` preflight for port 5174 returns HTTP 200 and permits `PUT`, `Authorization`, and `Content-Type`. The endpoint still validates the five IDs and scopes the Supabase update to the verified user's `profiles.id`.

**Still pending:** the SQL migration has not been executed automatically, and persistence, refresh/re-login, and cross-user RLS behavior still require an authorized live Supabase test. Do not mark avatar database persistence as verified until that test succeeds.

## Next steps to finish live upload verification

1. Create `wardrobe-images` as a **private** bucket in the Supabase Dashboard and apply the documented schema/RLS/Storage policies.
2. Sign in with an authorized test account, add a harmless test image, and verify the WebP object and metadata row in the Supabase dashboard.
3. Remove the test item and confirm both the metadata row and image are gone.
4. Record any environment-specific issues here without adding credentials or personal data.

The legal copy and technical controls are implementation aids, not a legal-compliance certification. Have the actual service operation and user-facing terms reviewed for applicable India requirements before production use.
