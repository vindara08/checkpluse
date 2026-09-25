import io

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main as api


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key")
    with TestClient(api.app) as test_client:
        yield test_client


def png_bytes(size=(80, 60)):
    image = Image.new("RGB", size, color=(45, 90, 70))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def transparent_png_bytes():
    image = Image.new("RGBA", (80, 60), color=(45, 90, 70, 0))
    image.putpixel((40, 30), (45, 90, 70, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def mock_user_verification(monkeypatch, *, status_code=200, body=None):
    response = httpx.Response(
        status_code,
        json=body if body is not None else {"id": "user-uuid"},
        request=httpx.Request("GET", "https://project.example.supabase.co/auth/v1/user"),
    )
    requests = []

    def fake_get(url, *, headers, timeout):
        requests.append((url, headers, timeout))
        return response

    monkeypatch.setattr(api.httpx, "get", fake_get)
    return requests


def test_health():
    with TestClient(api.app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_compression_requires_supabase_access_token(client, monkeypatch):
    mock_user_verification(monkeypatch)
    response = client.post(
        "/api/images/compress",
        files={"photo": ("shirt.png", png_bytes(), "image/png")},
    )
    assert response.status_code == 401


def test_compression_verifies_supabase_jwt_and_returns_metadata_stripped_webp(client, monkeypatch):
    requests = mock_user_verification(monkeypatch, body={"id": "owner-uuid"})
    response = client.post(
        "/api/images/compress",
        headers={"Authorization": "Bearer valid-user-access-token"},
        files={"photo": ("shirt.png", png_bytes((1800, 1200)), "image/png")},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert requests[0][0] == "https://project.example.supabase.co/auth/v1/user"
    assert requests[0][1] == {
        "apikey": "publishable-test-key",
        "Authorization": "Bearer valid-user-access-token",
    }
    with Image.open(io.BytesIO(response.content)) as result:
        assert result.format == "WEBP"
        assert result.size == (1600, 1067)
        assert not result.getexif()


def test_rejects_invalid_supabase_session(client, monkeypatch):
    mock_user_verification(monkeypatch, status_code=401, body={"message": "invalid token"})
    response = client.post(
        "/api/images/compress",
        headers={"Authorization": "Bearer invalid-token"},
        files={"photo": ("shirt.png", png_bytes(), "image/png")},
    )
    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()


def test_missing_supabase_publishable_configuration_is_explicit(client, monkeypatch):
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    response = client.post(
        "/api/images/compress",
        headers={"Authorization": "Bearer user-token"},
        files={"photo": ("shirt.png", png_bytes(), "image/png")},
    )
    assert response.status_code == 503
    assert "SUPABASE_PUBLISHABLE_KEY" in response.json()["detail"]


def test_compression_rejects_unsupported_media_type(client, monkeypatch):
    mock_user_verification(monkeypatch)
    response = client.post(
        "/api/images/compress",
        headers={"Authorization": "Bearer valid-token"},
        files={"photo": ("notes.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 415


def test_compress_image_reencodes_to_webp_and_bounds_dimensions():
    compressed = api.compress_image(png_bytes((1800, 1200)))
    with Image.open(io.BytesIO(compressed)) as result:
        assert result.format == "WEBP"
        assert result.size == (1600, 1067)
        assert not result.getexif()


def test_compress_image_composites_transparent_png_on_white():
    compressed = api.compress_image(transparent_png_bytes())
    with Image.open(io.BytesIO(compressed)) as result:
        assert result.getpixel((0, 0))[0] > 230
        assert result.getpixel((0, 0))[1] > 230
        assert result.getpixel((0, 0))[2] > 230
        assert result.getpixel((40, 30))[1] < 150


def test_compress_image_rejects_invalid_and_overlarge_inputs():
    with pytest.raises(api.HTTPException) as invalid:
        api.compress_image(b"not an image")
    assert invalid.value.status_code == 415

    with pytest.raises(api.HTTPException) as too_large:
        api.compress_image(b"x" * (api.MAX_UPLOAD_BYTES + 1))
    assert too_large.value.status_code == 413
