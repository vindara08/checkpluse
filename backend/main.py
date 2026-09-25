from __future__ import annotations

import io
import os
import warnings
from pathlib import Path
from typing import Annotated

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError

BACKEND_ENV_FILE = Path(__file__).resolve().parent / ".env"
load_dotenv(BACKEND_ENV_FILE, override=False)

APP_ORIGINS = [
    origin.strip()
    for origin in os.getenv("APP_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}

app = FastAPI(title="The Fold Image API", version="0.2.0", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=APP_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def limit_photo_request_size(request: Request, call_next):
    if request.url.path == "/api/images/compress":
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_UPLOAD_BYTES + 128_000:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Choose an image no larger than 8 MB."},
                    )
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid content length."})
    return await call_next(request)


def supabase_config() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    publishable_key = (
        os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        or os.getenv("SUPABASE_ANON_KEY", "").strip()
    )
    if not url or not publishable_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Supabase is not configured. Set SUPABASE_URL and "
                "SUPABASE_PUBLISHABLE_KEY in backend/.env, then restart the API."
            ),
        )
    return url, publishable_key


def authenticated_user_id(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to upload a photo.")
    access_token = authorization.removeprefix("Bearer ").strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="Sign in to upload a photo.")

    supabase_url, publishable_key = supabase_config()
    try:
        result = httpx.get(
            f"{supabase_url}/auth/v1/user",
            headers={
                "apikey": publishable_key,
                "Authorization": f"Bearer {access_token}",
            },
            timeout=8.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not verify your Supabase session. Please retry.",
        ) from exc

    if result.status_code == 401:
        raise HTTPException(status_code=401, detail="Your session expired. Sign in again.")
    if result.status_code != 200:
        raise HTTPException(status_code=502, detail="Supabase could not verify your session.")
    try:
        user_id = result.json()["id"]
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Supabase returned an invalid user session.") from exc
    return str(user_id)


def compress_image(data: bytes) -> bytes:
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Choose an image no larger than 8 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in ALLOWED_IMAGE_FORMATS:
                    raise HTTPException(status_code=415, detail="Use a JPG, PNG, or WebP image.")
                if source.width * source.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(status_code=413, detail="Image dimensions are too large.")
                oriented = ImageOps.exif_transpose(source)
                if "transparency" in oriented.info or oriented.mode in {"RGBA", "LA"}:
                    rgba = oriented.convert("RGBA")
                    image = Image.new("RGB", rgba.size, "white")
                    image.paste(rgba, mask=rgba.getchannel("A"))
                else:
                    image = oriented.convert("RGB")
                image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                image.save(output, format="WEBP", quality=82, method=6)
                return output.getvalue()
    except HTTPException:
        raise
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        ValueError,
    ) as exc:
        raise HTTPException(status_code=415, detail="That file is not a supported image.") from exc


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/images/compress", response_class=Response)
def compress_upload(
    user_id: Annotated[str, Depends(authenticated_user_id)],
    photo: Annotated[UploadFile, File()],
) -> Response:
    del user_id
    if photo.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Use a JPG, PNG, or WebP image.")
    compressed = compress_image(photo.file.read(MAX_UPLOAD_BYTES + 1))
    return Response(content=compressed, media_type="image/webp")
