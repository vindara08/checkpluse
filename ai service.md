# Project Check Plus

## AI Engine — Technical Specification & Development Blueprint

**Project:** Check Plus — Digital Wardrobe
**Document type:** AI architecture, technology stack, workflow, models, data structures, security and development plan
**Version:** 1.0
**Status:** Planning / AI Engine development
**Primary goal:** Convert a user's clothing image into reliable, structured wardrobe data with minimum manual input.

---

# 1. Core Objective

The AI system should solve the biggest problem in the current Check Plus workflow:

> **The user should not have to manually do work that the computer can reliably do.**

The target transformation is:

```text
Current:

Take photo
→ Upload
→ Manually identify clothing
→ Manually enter category
→ Manually enter type
→ Manually identify colours
→ Manually enter pattern
→ Save


Target:

Take/upload photo
→ AI checks image
→ AI detects clothing
→ AI isolates clothing
→ AI extracts attributes
→ AI calculates colours
→ AI produces structured data
→ User verifies/edits
→ Save
```

The AI should therefore function as an **assistant**, not as an uncontrolled automatic database writer.

---

# 2. High-Level Architecture

The existing production application remains separate.

```text
                    CHECK PLUS
                       │
        ┌──────────────┴──────────────┐
        │                             │
 Production Application          AI Engine
        │                             │
 Frontend                       Image Input
        │                             │
 Existing FastAPI              Quality Check
        │                             │
 Supabase                       Clothing Detection
        │                             │
 Wardrobe                       Segmentation
                                      │
                                 Attribute AI
                                      │
                                 Color Analysis
                                      │
                                 Validation
                                      │
                              Structured JSON
                                      │
                              Human Verification
                                      │
                               Approved Result
```

Initially:

```text
Check Plus Production Backend
        X
        X   ← NO DIRECT INTEGRATION YET
        X

Separate AI Engine
```

Once the AI engine is reliable:

```text
Check Plus Backend
       │
       │ HTTP request
       ▼
AI Engine
       │
       ▼
Structured JSON
       │
       ▼
Check Plus Backend
       │
       ▼
Supabase
```

---

# 3. Why We Are Building the AI Engine Separately

The existing Check Plus backend already works.

Changing it while experimenting with computer vision would create unnecessary risk.

The AI system will therefore initially have:

- its own Git repository
- its own Python environment
- its own FastAPI service
- its own test images
- its own JSON outputs
- its own logs
- its own experiments
- local/temporary storage during development

Only after the extraction pipeline becomes reliable will it be connected to Check Plus.

---

# 4. Technology Stack

## 4.1 Programming Language

### Python

Python will be the primary language.

Reasons:

- excellent computer-vision ecosystem
- strong machine-learning ecosystem
- easy experimentation
- FastAPI compatibility
- Pillow/OpenCV support
- YOLO/Ultralytics support
- easy JSON/Pydantic integration
- large research ecosystem

---

# 5. Backend Framework

## FastAPI

The AI engine will expose HTTP APIs.

Example:

```http
POST /analyze-clothing
```

Input:

```text
image
```

Output:

```json
{
  "success": true,
  "is_clothing": true,
  "confidence": 0.96,
  "attributes": {}
}
```

FastAPI will be responsible for:

- receiving images
- validating requests
- calling the AI pipeline
- returning structured results
- handling errors
- authentication when integrated
- API documentation
- request limits

---

# 6. Image Processing

## Pillow

Pillow will handle basic image operations.

Use cases:

- opening images
- resizing
- converting formats
- RGB/RGBA conversion
- image dimensions
- metadata handling
- thumbnail generation
- basic preprocessing

---

## OpenCV

OpenCV will handle more technical image analysis.

Use cases:

- blur detection
- brightness analysis
- contrast analysis
- exposure analysis
- image quality measurements
- colour-space conversion
- masking
- image preprocessing

Potential operations:

```text
BGR → RGB
RGB → HSV
RGB → LAB
```

Different colour spaces are useful for different image-analysis tasks.

---

# 7. Data Validation

## Pydantic

Pydantic will define the exact structure of AI output.

For example:

```json
{
  "category": "top",
  "type": "t_shirt",
  "colors": [
    {
      "name": "navy blue",
      "percentage": 62
    },
    {
      "name": "white",
      "percentage": 25
    }
  ],
  "pattern": "striped",
  "sleeve": "short"
}
```

The advantage is that the AI cannot simply return arbitrary text.

The result must conform to a predefined schema.

---

# 8. Main AI/CV Components

The AI engine will NOT be one giant model.

It will be a pipeline of specialized components.

```text
Image
 ↓
Image Quality
 ↓
Clothing Detection
 ↓
Clothing Segmentation
 ↓
Attribute Extraction
 ↓
Colour Analysis
 ↓
Confidence Validation
 ↓
Structured Result
```

This is important.

A single model trying to do everything would make debugging and reliability much harder.

---

# 9. Model 1 — Clothing Detection

## Purpose

Determine whether the uploaded image actually contains a supported clothing item.

Example:

```text
Photo of T-shirt
→ CLOTHING

Photo of dog
→ NOT CLOTHING

Photo of phone
→ NOT CLOTHING

Photo of food
→ NOT CLOTHING
```

---

## Candidate Technology

### YOLO / Ultralytics

YOLO is a strong candidate for object detection and segmentation.

The exact model version should be selected after benchmarking rather than permanently hard-coded at the beginning.

Potential responsibilities:

- detect clothing objects
- locate bounding boxes
- provide confidence scores
- optionally provide segmentation masks

Example:

```json
{
  "is_clothing": true,
  "confidence": 0.97,
  "detected_object": "shirt"
}
```

---

# 10. Detection Confidence

The system should not blindly trust every prediction.

Conceptual structure:

```text
High confidence
      ↓
Continue automatically

Medium confidence
      ↓
Ask user to confirm

Low confidence
      ↓
Reject / request another image
```

The exact numerical thresholds should be determined through testing.

For example, we should NOT simply decide:

```text
0.70 = correct
```

without testing.

Instead we will create a validation dataset and measure:

- false positives
- false negatives
- precision
- recall
- accuracy

Then choose thresholds.

---

# 11. Image Quality Analysis

This happens BEFORE expensive AI processing.

The system should first determine whether the photograph is usable.

---

## 11.1 File Validation

Check:

- file exists
- valid image format
- image can be decoded
- supported MIME type
- file size
- width
- height
- aspect ratio

Possible supported formats:

```text
JPEG
PNG
WEBP
```

---

# 12. Resolution Check

Very small images make AI extraction unreliable.

Example rule:

```text
Image too small
→ reject
→ ask user for a clearer image
```

The exact minimum resolution should be determined experimentally.

---

# 13. Blur Detection

OpenCV can estimate image sharpness using techniques such as the variance of the Laplacian.

Concept:

```text
Image
 ↓
Laplacian
 ↓
Variance
 ↓
Sharpness estimate
```

If the image is heavily blurred:

```text
Reject
```

User message:

> The image is too blurry. Please upload a clearer photo.

---

# 14. Brightness Detection

Calculate image luminance.

Potential outcomes:

```text
Too dark
→ ask for better lighting

Normal
→ continue

Too bright
→ check overexposure

Extremely bright
→ request another image
```

User message:

> The image is too dark for accurate clothing analysis. Please take another photo in brighter, even lighting.

---

# 15. Contrast Detection

Very low contrast can make:

- colour extraction
- pattern recognition
- segmentation

less reliable.

Therefore:

```text
Low contrast
→ warning/rejection depending on severity
```

---

# 16. Overexposure / Underexposure

We should also check for pixels that are excessively close to:

```text
0
```

or

```text
255
```

in RGB/brightness channels.

This can indicate loss of useful visual information.

Example:

```text
White shirt photographed with extreme light
→ details disappear
```

The system should request a better image rather than pretending the AI knows the missing information.

---

# 17. Image Quality Result

Internally we can create:

```json
{
  "quality": {
    "acceptable": true,
    "brightness": 0.61,
    "contrast": 0.72,
    "sharpness": 0.83,
    "resolution": {
      "width": 1200,
      "height": 1600
    },
    "issues": []
  }
}
```

This information is useful for debugging and later improving thresholds.

---

# 18. Privacy/Safety Gate

The preferred V1 workflow is:

```text
Clothing item photographed separately
```

rather than:

```text
Person wearing clothing
```

This reduces unnecessary personal-data processing.

If a person is detected, the system can initially respond:

> Please upload a photo of the clothing item itself rather than a photo containing a person.

Later, person-worn clothing extraction can be added as a separate capability.

---

# 19. Clothing Segmentation

Detection tells us:

```text
Where is the clothing?
```

Segmentation tells us:

```text
Which exact pixels belong to the clothing?
```

This is extremely important for colour extraction.

Example:

```text
Photo:
white T-shirt
on wooden floor
```

Without segmentation:

```text
AI sees:
white + brown + grey + background
```

With segmentation:

```text
AI sees:
T-shirt pixels only
```

---

# 20. Segmentation Model

The segmentation component can initially use a YOLO segmentation model if its performance is sufficient for our supported clothing categories.

If it does not provide adequate clothing masks, we can benchmark dedicated segmentation models later.

The architecture should therefore keep segmentation replaceable.

```text
Segmentation Interface
        │
        ├── Model A
        ├── Model B
        └── Future Model
```

The rest of the pipeline should not care which segmentation model produced the mask.

---

# 21. Background Removal

Once the clothing mask is obtained:

```text
Original image
      ↓
Clothing mask
      ↓
Background removed
```

The isolated clothing can then be used by:

- colour analysis
- pattern detection
- attribute extraction
- visual preview

---

# 22. Colour Analysis

Colour extraction should NOT analyse the entire image.

It must analyse:

```text
clothing pixels only
```

---

# 23. Multi-Colour Support

The wardrobe database should NOT store only:

```json
{
  "color": "blue"
}
```

because clothing can contain several important colours.

Instead:

```json
{
  "colors": [
    {
      "name": "navy blue",
      "percentage": 62
    },
    {
      "name": "white",
      "percentage": 25
    },
    {
      "name": "red",
      "percentage": 13
    }
  ]
}
```

The percentages describe the approximate distribution of visible clothing colours.

---

# 24. Raw Colour Representation

For better future matching, we can also store:

```json
{
  "name": "navy blue",
  "percentage": 62,
  "rgb": [20, 35, 80],
  "hex": "#142350"
}
```

This gives the recommendation engine more information than a simple colour name.

---

# 25. Colour Clustering

A possible approach:

```text
Clothing pixels
      ↓
Remove extreme/noisy pixels
      ↓
Convert colour space
      ↓
Cluster similar colours
      ↓
Calculate pixel percentage
      ↓
Map clusters to human-readable names
```

Possible algorithms:

- K-Means
- colour quantization
- LAB-space clustering

The exact method should be selected after testing real clothing photos.

---

# 26. Small Colour Noise

The system should not report every tiny colour variation.

Example:

```text
Blue shirt
with tiny 0.2% grey shadow
```

We don't want:

```text
blue
grey
black
dark grey
white
...
```

Instead, insignificant colours should be filtered.

---

# 27. Pattern Detection

The system should attempt to identify common patterns.

Initial categories:

```text
solid
striped
checked
printed
floral
graphic
camouflage
polka_dot
unknown
```

We should not create dozens of pattern classes initially.

If confidence is low:

```text
pattern = unknown
```

rather than hallucinating a pattern.

---

# 28. Clothing Category

Example categories:

```text
top
bottom
dress
outerwear
footwear
accessory
```

Then a more specific type:

```text
top
 ├── t_shirt
 ├── shirt
 ├── polo
 ├── sweatshirt
 └── hoodie

bottom
 ├── jeans
 ├── trousers
 ├── shorts
 └── track_pants

footwear
 ├── sneakers
 ├── formal_shoes
 ├── sandals
 └── boots
```

The exact supported taxonomy should be kept controlled.

---

# 29. Other Attributes

Useful first-generation attributes:

### Tops

- sleeve length
- neckline
- fit
- pattern

### Bottoms

- length
- fit
- style

### Footwear

- type
- dominant colours
- style

### Accessories

- type
- dominant colours
- material/style where reliably detectable

Do NOT attempt to extract 30 attributes immediately.

---

# 30. Attribute Confidence

Every AI-generated attribute should conceptually have confidence.

Example:

```json
{
  "category": {
    "value": "top",
    "confidence": 0.98
  },
  "type": {
    "value": "t_shirt",
    "confidence": 0.94
  },
  "pattern": {
    "value": "striped",
    "confidence": 0.76
  }
}
```

This lets the application distinguish:

```text
AI is confident
```

from:

```text
AI is guessing
```

---

# 31. Human Verification

The AI should NOT immediately save uncertain information.

Recommended flow:

```text
AI result
    ↓
User sees extracted information
    ↓
User confirms
    ↓
User edits if necessary
    ↓
Save
```

Example:

```text
Detected:

Category: Top
Type: T-shirt
Colours:
  Navy Blue — 62%
  White — 25%
  Red — 13%
Pattern: Striped

[Confirm] [Edit]
```

This provides a safety net against model errors.

---

# 32. User Corrections

When the user changes:

```text
AI:
shirt

User:
t-shirt
```

we should store both:

```json
{
  "ai_prediction": "shirt",
  "user_correction": "t_shirt"
}
```

This is valuable future evaluation data.

---

# 33. Do NOT Automatically Train on User Data

The first version should NOT automatically use every uploaded image or correction as training data.

Instead:

```text
User data
 ↓
Normal product operation
```

is kept separate from:

```text
Explicitly approved research/training dataset
```

If we later want to use images for model improvement, that should be handled through a clearly defined data-use and consent process.

---

# 34. Final AI JSON Schema

A possible first version:

```json
{
  "success": true,

  "image": {
    "width": 1200,
    "height": 1600,
    "format": "jpeg"
  },

  "quality": {
    "acceptable": true,
    "issues": []
  },

  "clothing_detection": {
    "is_clothing": true,
    "category": "top",
    "confidence": 0.97
  },

  "attributes": {
    "type": {
      "value": "t_shirt",
      "confidence": 0.94
    },

    "colors": [
      {
        "name": "navy blue",
        "percentage": 62,
        "rgb": [20, 35, 80],
        "hex": "#142350"
      },
      {
        "name": "white",
        "percentage": 25,
        "rgb": [245, 245, 245],
        "hex": "#F5F5F5"
      }
    ],

    "pattern": {
      "value": "striped",
      "confidence": 0.89
    },

    "sleeve": {
      "value": "short",
      "confidence": 0.92
    }
  },

  "requires_user_confirmation": true
}
```

---

# 35. Error JSON

If the upload is not usable, the API should return a structured error.

Example:

```json
{
  "success": false,
  "error": {
    "code": "IMAGE_TOO_DARK",
    "message": "The image is too dark for reliable clothing analysis.",
    "action": "UPLOAD_BETTER_IMAGE"
  }
}
```

Other codes:

```text
INVALID_FILE
UNSUPPORTED_FORMAT
IMAGE_TOO_LARGE
IMAGE_TOO_SMALL
IMAGE_BLURRY
IMAGE_TOO_DARK
IMAGE_TOO_BRIGHT
LOW_CONTRAST
NO_CLOTHING_DETECTED
LOW_DETECTION_CONFIDENCE
MULTIPLE_ITEMS_DETECTED
UNSUPPORTED_CLOTHING_TYPE
PROCESSING_FAILED
```

---

# 36. Multiple Clothing Items

This needs to be considered from the beginning.

Example:

```text
One photograph:
T-shirt + jeans + shoes
```

The AI could detect:

```json
{
  "items": [
    {
      "category": "top"
    },
    {
      "category": "bottom"
    },
    {
      "category": "footwear"
    }
  ]
}
```

For V1, the simplest workflow should probably be:

```text
ONE IMAGE
→ ONE PRIMARY CLOTHING ITEM
```

If multiple items are detected:

```text
Please upload one clothing item at a time.
```

Later we can support batch/multi-item extraction.

---

# 37. Duplicate Detection

Eventually, the AI engine should identify whether the same clothing item already exists.

Possible future pipeline:

```text
New image
 ↓
Visual embedding
 ↓
Compare against existing wardrobe
 ↓
Similarity score
 ↓
Possible duplicate
```

This should NOT be part of the first extraction milestone.

---

# 38. Image Embeddings

A future computer-vision embedding model could represent clothing visually as a vector.

Example:

```text
Image
 ↓
Embedding model
 ↓
[0.12, -0.43, 0.88, ...]
```

This could later support:

- duplicate detection
- visual similarity
- outfit matching
- “similar clothes”
- recommendation ranking

We should design the system so this can be added later.

---

# 39. Recommendation Engine — Later Phase

The extraction engine comes first.

Only after we have reliable structured wardrobe data should we build outfit recommendation.

Target:

```text
Wardrobe
 ↓
Candidate combinations
 ↓
Compatibility analysis
 ↓
Ranking
 ↓
Recommended outfits
```

---

# 40. Recommendation Inputs

Future recommendation logic can use:

```text
Colour
Category
Pattern
Style
Season
Occasion
User preferences
Previous outfit feedback
Weather
```

Weather/location should be optional and only collected/used when genuinely needed.

---

# 41. Recommendation System Architecture

Do NOT start with a huge generative AI system.

Use a layered approach.

```text
Hard constraints
      ↓
Compatibility rules
      ↓
Scoring
      ↓
Optional AI ranking
      ↓
Final recommendations
```

Example:

```text
Shorts + winter-only heavy jacket
→ lower compatibility

Formal trousers + formal shoes
→ compatible

Three highly competing patterns
→ lower score
```

This makes recommendations explainable.

---

# 42. Future Personalisation

Eventually:

```text
AI recommends outfit
       ↓
User likes/dislikes
       ↓
Preference history
       ↓
Recommendation improves
```

Possible feedback:

```text
Like
Dislike
Wear
Save
Skip
```

This creates a personal recommendation system.

---

# 43. Everything Else — Later AI Layer

After extraction and recommendation are reliable, other capabilities can be added.

Potential future features:

```text
Outfit generation
Duplicate detection
Similar-item search
Wardrobe statistics
Seasonal organization
Occasion-based outfits
Weather-based recommendations
Packing assistance
Capsule wardrobe planning
Shopping gap analysis
Style preference learning
```

These are NOT V1 priorities.

---

# 44. Complete V1 Pipeline

The first complete AI system should be:

```text
USER
 │
 ▼
Upload Image
 │
 ▼
File Validation
 │
 ├── Invalid → Reject
 │
 ▼
Privacy/Image Safety Check
 │
 ▼
Image Quality Analysis
 │
 ├── Too dark → Ask for better image
 ├── Too bright → Ask for better image
 ├── Too blurry → Ask for clearer image
 ├── Too small → Ask for higher resolution
 │
 ▼
Clothing Detection
 │
 ├── Not clothing → Reject
 ├── Low confidence → Ask user
 │
 ▼
Segmentation
 │
 ▼
Background Isolation
 │
 ▼
Attribute Extraction
 │
 ├── Category
 ├── Type
 ├── Pattern
 ├── Sleeve/length where applicable
 │
 ▼
Colour Analysis
 │
 ├── Dominant colour
 ├── Secondary colour
 └── Accent colours
 │
 ▼
Confidence Validation
 │
 ▼
Structured JSON
 │
 ▼
USER REVIEW
 │
 ├── Confirm
 └── Edit
 │
 ▼
CHECK PLUS BACKEND
 │
 ▼
SUPABASE
```

---

# 45. API Design

Initial AI API:

```http
POST /analyze-clothing
```

Possible future endpoints:

```http
GET /health

POST /analyze-clothing

POST /analyze-batch

POST /detect-duplicate

POST /generate-outfits

POST /rank-outfits
```

But only `/analyze-clothing` needs to exist initially.

---

# 46. Suggested Project Structure

```text
check-plus-ai/
│
├── app/
│   ├── main.py
│   │
│   ├── api/
│   │   └── analyze.py
│   │
│   ├── schemas/
│   │   ├── image.py
│   │   ├── quality.py
│   │   ├── clothing.py
│   │   └── response.py
│   │
│   ├── pipeline/
│   │   ├── quality.py
│   │   ├── detection.py
│   │   ├── segmentation.py
│   │   ├── attributes.py
│   │   ├── colors.py
│   │   └── validation.py
│   │
│   ├── models/
│   │   ├── detector.py
│   │   ├── segmenter.py
│   │   └── attribute_model.py
│   │
│   ├── utils/
│   │   ├── image.py
│   │   ├── logging.py
│   │   └── errors.py
│   │
│   └── config.py
│
├── tests/
│   ├── test_quality.py
│   ├── test_detection.py
│   ├── test_colors.py
│   └── test_pipeline.py
│
├── datasets/
│   └── README.md
│
├── experiments/
│
├── requirements.txt
│
├── .env.example
├── README.md
└── Dockerfile
```

---

# 47. Testing Dataset

Before declaring the AI reliable, we need a controlled test set.

Categories should include:

### Clothing

- T-shirts
- shirts
- jeans
- trousers
- shorts
- dresses
- hoodies
- jackets
- shoes
- accessories

### Non-clothing

- phones
- laptops
- food
- furniture
- animals
- random objects
- landscapes

### Bad images

- dark
- overexposed
- blurry
- low resolution
- cluttered background
- extreme angles

### Difficult clothing

- black clothes
- white clothes
- reflective materials
- patterned clothing
- multicolour clothing
- camouflage
- similar colours
- transparent/very thin materials

---

# 48. Evaluation Metrics

For clothing detection:

```text
Precision
Recall
F1
False-positive rate
False-negative rate
```

For attributes:

```text
Category accuracy
Type accuracy
Pattern accuracy
Sleeve accuracy
```

For colour:

```text
Dominant-colour accuracy
Colour-palette similarity
```

For image-quality detection:

```text
Correct rejection rate
False rejection rate
```

---

# 49. Most Important Metric

The ultimate metric is not:

> "How impressive is the AI model?"

It is:

> **How much manual work does the user have to correct?**

Example:

```text
Before AI:
8 manual fields

After AI:
2 corrections

Excellent improvement.
```

If the AI creates five wrong fields and the user has to fix everything, it has failed even if the model looks impressive in a demo.

---

# 50. Logging

During development we should log:

```text
request ID
processing time
model versions
quality result
detection result
confidence values
pipeline errors
```

Avoid logging unnecessary image contents or personal information.

---

# 51. Model Versioning

Every AI result should ideally be traceable to the model version that generated it.

Example:

```json
{
  "engine_version": "0.1.0",
  "detector_version": "model_a_v1",
  "attribute_model_version": "attribute_v1"
}
```

This becomes extremely useful when a model is replaced.

---

# 52. Processing Time

We should measure:

```text
Upload
 ↓
Quality check: X ms
 ↓
Detection: X ms
 ↓
Segmentation: X ms
 ↓
Attributes: X ms
 ↓
Colour: X ms
 ↓
Total: X seconds
```

The user should not have to wait unnecessarily for every stage.

---

# 53. Local Development Constraints

The current development laptop has limited integrated graphics.

Therefore:

```text
NO CUSTOM LARGE-MODEL TRAINING
```

initially.

Use:

- pretrained models
- CPU-compatible inference where practical
- small models
- cloud/GPU only when necessary
- modular architecture

The objective is to **prove the pipeline before spending money on infrastructure**.

---

# 54. Model Selection Philosophy

We should NOT choose models because:

```text
"This model is popular."
```

Instead:

```text
Candidate model
 ↓
Test on our dataset
 ↓
Measure accuracy
 ↓
Measure speed
 ↓
Measure memory
 ↓
Measure licence
 ↓
Measure deployment cost
 ↓
Choose
```

The model is replaceable.

The pipeline is the important asset.

---

# 55. Licence Check

Before deploying any model publicly, check:

- model licence
- dataset licence
- commercial-use restrictions
- attribution requirements
- redistribution requirements
- dependency licences

This must be done before production integration.

---

# 56. India Privacy / Data Protection

The system should be designed around privacy from the beginning.

India's Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025 are the primary framework we need to account for when handling applicable digital personal data. MeitY notified the 2025 Rules on 13 November 2025 and specified a phased commencement schedule, so the implementation date of a particular provision must be checked rather than assuming every provision applies immediately.

The product should therefore implement privacy-by-design rather than waiting until launch.

---

# 57. Data Minimisation

Do not collect data simply because it is technically possible.

For example, we generally do not need:

```text
GPS coordinates
Exact device location
Unrelated device identifiers
Unnecessary EXIF metadata
```

for clothing recognition.

Strip unnecessary metadata where practical.

---

# 58. Image Retention

Recommended lifecycle:

```text
Upload
 ↓
Process
 ↓
Accepted
 → store only what product needs

Rejected
 → delete temporary processing copy
```

Do not keep rejected images indefinitely.

---

# 59. Training Data Separation

Very important:

```text
User's wardrobe
        ≠
Training dataset
```

If we later want to use images or corrections for model development, that should have a separately defined purpose and appropriate user-facing disclosure/consent and retention design.

We should never secretly retain deleted user images for future training.

The 2025 Rules require clear, understandable notices describing the personal data involved and the specified purposes of processing.

---

# 60. Authentication & Authorisation

When integrated with Check Plus:

```text
User A
 ↓
AI request
 ↓
Only User A's data
```

must be accessible.

Never trust:

```text
user_id supplied by frontend
```

without validating the authenticated identity.

The backend must enforce ownership.

---

# 61. Supabase Security

The frontend must NEVER contain:

```text
Supabase service-role key
```

Sensitive credentials belong on the server.

Use:

```text
Frontend
 ↓
Backend
 ↓
Supabase
```

for privileged operations.

Use appropriate Supabase Row Level Security and controlled storage access when integrating the AI engine.

---

# 62. API Security

The AI service should eventually have:

- HTTPS
- authentication
- request-size limits
- file-type validation
- rate limiting
- timeout limits
- controlled CORS
- environment-based secrets
- dependency updates
- error handling
- monitoring

---

# 63. Temporary Files

Uploaded images should not accumulate on the AI server.

Preferred pattern:

```text
Receive
 ↓
Process
 ↓
Return result
 ↓
Delete temporary file
```

unless the file has an explicit reason to be retained.

---

# 64. Privacy Notice

The application should eventually clearly explain:

```text
What data is collected
Why it is collected
How it is used
How long it is retained
Who processes it
How users can exercise applicable rights
```

The 2025 Rules specifically call for clear, standalone, understandable notices containing an itemised description of personal data and the specified purposes.

This document is an engineering plan, not legal advice. Before a larger public rollout, the actual implementation, privacy notice, retention policy, vendors and age-related handling should be reviewed appropriately.

---

# 65. What We Will NOT Build Initially

Do NOT start with:

```text
Custom model training
Huge recommendation model
AI stylist chatbot
Virtual try-on
Shopping recommendations
Skin-tone analysis
Face analysis
Body analysis
Automatic user profiling
Massive fashion dataset
Complex agent architecture
```

These can consume enormous time without fixing the primary problem.

---

# 66. V1 Scope

V1 should contain only:

```text
1. Image upload
2. File validation
3. Image-quality detection
4. Clothing/non-clothing detection
5. Clothing segmentation
6. Background isolation
7. Clothing category
8. Clothing type
9. Multi-colour extraction
10. Pattern detection
11. Selected useful attributes
12. Confidence scores
13. Structured JSON
14. User confirmation
15. Error handling
16. Logging
17. Test dataset
```

That is enough.

---

# 67. V1.5

After V1 works:

```text
Multiple-item detection
Better attribute extraction
Duplicate detection
Improved colour names
Better pattern recognition
Embedding generation
Performance optimisation
Production integration
```

---

# 68. V2

Then:

```text
Outfit generation
Outfit compatibility scoring
Personal preferences
Feedback learning
Weather-aware recommendations
Occasion-aware recommendations
Similar clothing search
```

---

# 69. V3

Only after the fundamentals work:

```text
Advanced recommendation system
Personal style modelling
Shopping gap analysis
Packing assistant
Wardrobe planning
Advanced multimodal AI
Potential virtual try-on
```

---

# 70. Complete Development Order

The actual development order should be:

```text
PHASE 0
Project setup
 ↓
PHASE 1
Image upload + validation
 ↓
PHASE 2
Image quality engine
 ↓
PHASE 3
Clothing detection
 ↓
PHASE 4
Segmentation
 ↓
PHASE 5
Colour extraction
 ↓
PHASE 6
Attribute extraction
 ↓
PHASE 7
Confidence + validation
 ↓
PHASE 8
JSON output
 ↓
PHASE 9
Human verification UI/API
 ↓
PHASE 10
Testing + benchmarking
 ↓
PHASE 11
Production integration
 ↓
PHASE 12
Outfit recommendation engine
```

---

# 71. First Milestone

The first actual milestone is NOT:

> "Build an AI fashion system."

It is:

> **Give the system one clothing image and get a useful, structured, confidence-scored result back.**

Example:

```text
INPUT
shirt.jpg

OUTPUT

Clothing: YES
Confidence: 97%

Category:
Top

Type:
T-shirt

Colours:
Navy blue — 62%
White — 25%
Red — 13%

Pattern:
Striped — 89%

Image quality:
Good

Result:
REQUIRES USER CONFIRMATION
```

If this works reliably across a test dataset, we move forward.

---

# 72. Final Technology Map

```text
LANGUAGE
Python

API
FastAPI

IMAGE PROCESSING
Pillow
OpenCV

DETECTION
YOLO / Ultralytics candidate

SEGMENTATION
YOLO segmentation candidate
+ replaceable segmentation interface

ATTRIBUTE EXTRACTION
Specialised CV/model pipeline
+ replaceable model interface

COLOUR
OpenCV
NumPy
Clustering / colour quantisation

DATA VALIDATION
Pydantic

DATA FORMAT
JSON

EXPERIMENT STORAGE
Local files / SQLite initially

PRODUCTION DATABASE
Supabase

PRODUCTION BACKEND
Existing Check Plus FastAPI

FRONTEND
Existing Check Plus frontend

DEPLOYMENT
Separate AI service initially

VERSION CONTROL
Separate Git repository

TESTING
Python test framework
+ manually curated image dataset

SECURITY
HTTPS
Authentication
Authorisation
Rate limiting
Input validation
Secrets management
Controlled storage

PRIVACY
Data minimisation
Metadata stripping
Controlled retention
Explicit purpose separation
User confirmation
No hidden training-data collection
```

---

# 73. The Core Engineering Principle

The entire system should follow one rule:

```text
AUTOMATE WHAT IS RELIABLE.
VERIFY WHAT IS UNCERTAIN.
REJECT WHAT IS UNUSABLE.
NEVER PRETEND THE AI KNOWS SOMETHING IT DOESN'T.
```

The AI should therefore behave like:

```text
Computer vision
       +
structured data extraction
       +
confidence estimation
       +
human verification
```

rather than:

```text
"AI magically understands clothes."
```

---

# 74. Final Target Architecture

Eventually Project Check Plus should become:

```text
                    CHECK PLUS
                        │
                        ▼
                 USER UPLOADS PHOTO
                        │
                        ▼
                ┌───────────────┐
                │  AI ENGINE    │
                └───────────────┘
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
          QUALITY   DETECTION   SEGMENTATION
             │          │          │
             └──────────┼──────────┘
                        ▼
                 ATTRIBUTE ENGINE
                        │
              ┌─────────┼─────────┐
              ▼         ▼         ▼
           CATEGORY   COLOUR    PATTERN
              │         │         │
              └─────────┼─────────┘
                        ▼
                 CONFIDENCE CHECK
                        │
                        ▼
                STRUCTURED JSON
                        │
                        ▼
                 USER CONFIRMS
                        │
                        ▼
                CHECK PLUS API
                        │
                        ▼
                    SUPABASE
                        │
                        ▼
                     WARDROBE
                        │
                        ▼
              ┌───────────────────┐
              │ FUTURE AI ENGINE  │
              │ Outfit Matching   │
              │ Recommendations   │
              │ Personalisation   │
              └───────────────────┘
```

**This is the architecture we should build toward.**

The important part is that the system is **modular**. We can replace a detector, segmentation model, colour algorithm, or attribute model without rewriting the entire Check Plus application.
