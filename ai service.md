# Main 9 — Current The Fold Integration

This document describes the implementation currently present in this repository. It replaces the earlier speculative AI-engine blueprint and does not describe unimplemented future models as current behavior.

## Runtime architecture

Main 9 is imported by the existing FastAPI service; it is not a separate deployed application or a paid third-party AI API.

```text
React upload/review UI
   │ original photo + signed-in Supabase session
   ▼
FastAPI POST /api/images/analyze
   │ token validation + temporary image
   ▼
Main 9 / YOLO segmentation / attribute analysis
   │ all valid item suggestions
   ▼
Human review and edits in React
   │ explicit Save only
   ├── FastAPI POST /api/images/compress → private Supabase Storage
   └── Supabase Postgres                 → one row per reviewed item
```

FastAPI verifies the Supabase access token before analysis and image compression. The analysis route reads the upload into memory, writes a temporary file for Main 9, and does not write to Supabase Storage or Postgres. Temporary data is discarded after analysis. The optional desktop Tkinter UI is not required by the headless API.

## Checkpoint and model evidence

`main9.py` loads `best.pt` next to the source file. The bundled checkpoint was loaded and inspected in the project Python environment. It reports:

- Ultralytics task: `segment`.
- Checkpoint model configuration: `yolo26n-seg.yaml`, scale `n` (YOLO26n-seg).
- 13 class labels, listed below.
- Training metadata path: `/kaggle/working/wardrobe_yolo/data.yaml`.

This evidence does **not** identify the checkpoint as YOLO26s and does **not** establish DeepFashion2 as its training dataset. Do not claim either without a checkpoint/dataset provenance record that supports it. YOLO26s and DeepFashion2 are not part of the verified current-stack description.

Inference in `main9.py` uses `imgsz=416`, `conf=0.5`, and `agnostic_nms=True`. The model receives the original image path; the app does not pre-distort the analysis image to a square.

### Supported labels and categories

| Model label | Application category |
|---|---|
| `short_sleeve_top` | Top |
| `long_sleeve_top` | Top |
| `vest` | Top |
| `sling` | Top |
| `shorts` | Bottom |
| `trousers` | Bottom |
| `skirt` | Bottom |
| `short_sleeve_outwear` | Outerwear |
| `long_sleeve_outwear` | Outerwear |
| `short_sleeve_dress` | Dress |
| `long_sleeve_dress` | Dress |
| `vest_dress` | Dress |
| `sling_dress` | Dress |

Shoes are not among the checkpoint's classes. No shoe class is invented or inferred.

## Per-image processing

1. Run YOLO26n segmentation and collect its raw detections.
2. Sort detections by confidence and use the existing same-class box overlap/containment/split-garment heuristics to filter duplicate detections. This is a geometric duplicate filter, not a guarantee of perfect identity matching.
3. For each retained detection, use the corresponding segmentation mask and model label to compute category and visual attributes.
4. Append one result per valid detection to the complete response list.
5. Main 9 logs raw and filtered detection counts and processed class names. FastAPI logs the number and types returned.

Main 9 does not reduce the retained list to only its first detected clothing object. The backend can return multiple distinct pieces from one photo; the frontend renders a review form for every returned item. At Save, the browser makes a separate wardrobe row and unique Storage path for each verified piece, preserving independent item IDs for the existing outfit links.

## Attributes

### AI-proposed fields

- Clothing Type
- Category
- Dominant Color
- Secondary Color (only reported when a secondary cluster passes the code's threshold)
- Color Family
- Brightness
- Pattern

Color attributes are calculated from pixels within each segmentation mask. Main 9 uses KMeans clustering for dominant and secondary colors, maps colors to named colors/families, and derives brightness from weighted RGB intensity. Pattern classification examines masked grayscale texture and edge/line density with fixed heuristics; it is not a dedicated trained fashion-attribute model.

Detection/pattern confidence values exist inside the model/analysis internals. FastAPI removes them before returning the result, and they are not editable wardrobe fields, not included in wardrobe exports, and not stored by the current schema.

### User-provided fields

- Season
- Formality
- Occasion
- Note (optional free text)

**Season, Formality and Occasion are not inferred by AI and must be explicitly selected by the user for each item before saving.** The AI suggestions are provisional; the user may edit each AI field independently.

## Human-in-the-loop storage behavior

```text
Choose photo
→ authenticated temporary analysis
→ reject unsupported image OR show every retained detection
→ user reviews/corrects each AI field
→ user explicitly selects Season, Formality, Occasion per item
→ user confirms Save
→ FastAPI/Pillow converts to WebP and strips metadata
→ private Storage object + Postgres row per verified item
```

An unsupported image or a user cancellation does not create a permanent item. Storage/database writes begin only after explicit confirmation. The frontend tracks uploaded paths so it can attempt cleanup if saving a multi-item set fails part-way; cleanup or live persistence still requires verification against the configured Supabase project.

## Limitations and operational checks

- Thirteen classes only; no shoe detection.
- Some Indian ethnic clothing may be detected less reliably.
- Heuristic duplicate filtering can make mistakes on unusual overlaps/split views.
- Pattern results are heuristic and can be wrong; user review remains necessary.
- The checkpoint metadata does not confirm DeepFashion2 provenance.
- This repository's SQL migration is manual. Confirm the structured wardrobe migration and private bucket's WebP MIME configuration in Supabase before production saves.
- The inference call does not require a GPU; a CPU-only backend environment is supported. The deployed runtime's actual hardware has not been verified. No paid AI service is required.

For project setup, RLS, environment variables, and known unverified live checks, see [README.md](./README.md), [SUPABASE_SETUP.md](./SUPABASE_SETUP.md), and [DIGITAL_WARDROBE_PLAN.md](./DIGITAL_WARDROBE_PLAN.md).
