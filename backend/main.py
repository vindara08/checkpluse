from __future__ import annotations

import io
import logging
import os
import tempfile
import warnings
from pathlib import Path
from typing import Annotated, Any, Literal, NamedTuple, get_args

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel

BACKEND_ENV_FILE = Path(__file__).resolve().parent / ".env"
load_dotenv(BACKEND_ENV_FILE, override=False)

CONFIGURED_APP_ORIGINS = {
    origin.strip()
    for origin in os.getenv("APP_ORIGINS", "").split(",")
    if origin.strip()
}
APP_ORIGINS = sorted(CONFIGURED_APP_ORIGINS | {
    "http://localhost:5173",
    "http://localhost:5174",
})
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
AvatarId = Literal["fern", "terracotta", "sage", "indigo", "ochre"]
ALLOWED_AVATAR_IDS = get_args(AvatarId)
logger = logging.getLogger(__name__)

app = FastAPI(title="The Fold API", version="0.3.0", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=APP_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
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


class AuthenticatedUser(NamedTuple):
    user_id: str
    access_token: str


def authenticated_user(
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    access_token = authorization.removeprefix("Bearer ").strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="Sign in to continue.")

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
    return AuthenticatedUser(str(user_id), access_token)


def authenticated_user_id(
    authenticated: Annotated[AuthenticatedUser, Depends(authenticated_user)],
) -> str:
    return authenticated.user_id


def supabase_user_headers(authenticated: AuthenticatedUser) -> dict[str, str]:
    _, publishable_key = supabase_config()
    return {
        "apikey": publishable_key,
        "Authorization": f"Bearer {authenticated.access_token}",
    }


def supabase_error(response: httpx.Response, operation: str) -> None:
    if 200 <= response.status_code < 300:
        return
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="Your session expired. Sign in again.")
    logger.warning("Supabase %s request failed with status %s", operation, response.status_code)
    raise HTTPException(status_code=502, detail=f"Supabase could not {operation}. Please retry.")


class AvatarUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    avatar_id: AvatarId


def get_profile_avatar_id(authenticated: AuthenticatedUser) -> str:
    supabase_url, _ = supabase_config()
    try:
        response = httpx.get(
            f"{supabase_url}/rest/v1/profiles",
            params={"select": "avatar_id", "id": f"eq.{authenticated.user_id}"},
            headers=supabase_user_headers(authenticated),
            timeout=8.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("Profile avatar selection read request failed")
        raise HTTPException(status_code=502, detail="Could not read your avatar selection. Please retry.") from exc
    supabase_error(response, "read your profile")
    try:
        rows = response.json()
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Supabase returned an invalid profile response.") from exc
    if not isinstance(rows, list):
        raise HTTPException(status_code=502, detail="Supabase returned an invalid profile response.")
    if not rows:
        raise HTTPException(status_code=404, detail="Your profile could not be found.")
    if not isinstance(rows[0], dict):
        raise HTTPException(status_code=502, detail="Supabase returned an invalid profile response.")
    avatar_id = rows[0].get("avatar_id")
    if avatar_id not in ALLOWED_AVATAR_IDS:
        logger.error("Profile row contains an unsupported built-in avatar identifier")
        raise HTTPException(status_code=409, detail="Your saved avatar selection is invalid.")
    return avatar_id


def update_profile_avatar_id(authenticated: AuthenticatedUser, avatar_id: str) -> bool:
    supabase_url, _ = supabase_config()
    try:
        response = httpx.patch(
            f"{supabase_url}/rest/v1/profiles",
            params={"id": f"eq.{authenticated.user_id}"},
            headers={
                **supabase_user_headers(authenticated),
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            json={"avatar_id": avatar_id},
            timeout=8.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("Profile avatar selection update request failed")
        raise HTTPException(status_code=502, detail="Could not save your avatar selection. Please retry.") from exc
    supabase_error(response, "save your avatar selection")
    try:
        rows = response.json()
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Supabase returned an invalid profile update response.") from exc
    if not isinstance(rows, list):
        raise HTTPException(status_code=502, detail="Supabase returned an invalid profile update response.")
    return bool(rows)


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


def load_main9_module():
    root = Path(__file__).resolve().parents[1]
    module_path = root / "main9.py"
    if not module_path.exists():
        raise FileNotFoundError(f"Missing Main 9 model entrypoint: {module_path}")
    import importlib.util

    spec = importlib.util.spec_from_file_location("checkplus_main9", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load Main 9 module from {module_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def analyze_uploaded_image(data: bytes) -> dict[str, Any]:
    try:
        module = load_main9_module()
    except Exception as exc:  # pragma: no cover - depends on local AI runtime
        raise HTTPException(
            status_code=503,
            detail="Main 9 AI is not available in this environment. Please configure the model and try again.",
        ) from exc

    suffix = ".png"
    if data[:2] == b"\xFF\xD8":
        suffix = ".jpg"
    elif data[:4] == b"RIFF":
        suffix = ".webp"

    with tempfile.NamedTemporaryFile(suffix=suffix) as image_file:
        image_file.write(data)
        image_file.flush()
        result = module.analyze_image(image_file.name)

    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Main 9 returned an invalid analysis result.")
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message") or "No supported clothing was detected in that image.")
    return result


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/profile/avatar")
def get_profile_avatar(
    authenticated: Annotated[AuthenticatedUser, Depends(authenticated_user)],
) -> dict[str, str]:
    return {"avatar_id": get_profile_avatar_id(authenticated)}


@app.put("/api/profile/avatar")
def update_profile_avatar(
    authenticated: Annotated[AuthenticatedUser, Depends(authenticated_user)],
    selection: AvatarUpdate,
) -> dict[str, str]:
    if not update_profile_avatar_id(authenticated, selection.avatar_id):
        raise HTTPException(status_code=404, detail="Your profile could not be found.")
    return {"avatar_id": selection.avatar_id}


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


@app.post("/api/images/analyze")
def analyze_upload(
    user_id: Annotated[str, Depends(authenticated_user_id)],
    photo: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    del user_id
    if photo.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Use a JPG, PNG, or WebP image.")
    image_bytes = photo.file.read(MAX_UPLOAD_BYTES + 1)
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Choose an image no larger than 8 MB.")
    return analyze_uploaded_image(image_bytes)
