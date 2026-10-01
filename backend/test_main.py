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
    assert response.status_code == 200, response.text
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
    assert response.status_code == 415, response.text


def test_avatar_get_returns_current_builtin_selection(client, monkeypatch):
    mock_user_verification(monkeypatch)
    monkeypatch.setattr(api, "get_profile_avatar_id", lambda authenticated: "fern")

    response = client.get("/api/profile/avatar", headers={"Authorization": "Bearer test-token"})

    assert response.status_code == 200
    assert response.json() == {"avatar_id": "fern"}


def test_avatar_preflight_allows_local_frontend_origins(client):
    response = client.options(
        "/api/profile/avatar",
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5174"
    assert "PUT" in response.headers["access-control-allow-methods"]


def test_avatar_update_saves_allowed_id_for_authenticated_profile(client, monkeypatch):
    mock_user_verification(monkeypatch, body={"id": "owner-uuid"})
    updates = []
    monkeypatch.setattr(
        api,
        "update_profile_avatar_id",
        lambda authenticated, avatar_id: updates.append((authenticated.user_id, avatar_id)) or True,
    )

    response = client.put(
        "/api/profile/avatar",
        headers={"Authorization": "Bearer test-token"},
        json={"avatar_id": "indigo"},
    )

    assert response.status_code == 200
    assert response.json() == {"avatar_id": "indigo"}
    assert updates == [("owner-uuid", "indigo")]


def test_avatar_update_rejects_unknown_id(client, monkeypatch):
    mock_user_verification(monkeypatch)
    updates = []
    monkeypatch.setattr(
        api,
        "update_profile_avatar_id",
        lambda authenticated, avatar_id: updates.append(avatar_id) or True,
    )

    response = client.put(
        "/api/profile/avatar",
        headers={"Authorization": "Bearer test-token"},
        json={"avatar_id": "arbitrary_url"},
    )

    assert response.status_code == 422
    assert updates == []


def test_avatar_update_rejects_extra_upload_fields(client, monkeypatch):
    mock_user_verification(monkeypatch)
    updates = []
    monkeypatch.setattr(
        api,
        "update_profile_avatar_id",
        lambda authenticated, avatar_id: updates.append(avatar_id) or True,
    )

    response = client.put(
        "/api/profile/avatar",
        headers={"Authorization": "Bearer test-token"},
        json={"avatar_id": "sage", "image": "data:image/svg+xml,..."},
    )

    assert response.status_code == 422
    assert updates == []


def test_avatar_update_is_scoped_to_verified_user_and_uses_user_token(client, monkeypatch):
    request_details = {}

    def fake_patch(url, *, params, headers, json, timeout):
        request_details.update(
            url=url,
            params=params,
            headers=headers,
            json=json,
            timeout=timeout,
        )
        return httpx.Response(
            200,
            json=[{"id": "verified-user-id", "avatar_id": "ochre"}],
            request=httpx.Request("PATCH", url),
        )

    monkeypatch.setattr(api.httpx, "patch", fake_patch)
    authenticated = api.AuthenticatedUser("verified-user-id", "user-access-token")

    assert api.update_profile_avatar_id(authenticated, "ochre")
    assert request_details["url"] == "https://project.example.supabase.co/rest/v1/profiles"
    assert request_details["params"] == {"id": "eq.verified-user-id"}
    assert request_details["json"] == {"avatar_id": "ochre"}
    assert request_details["headers"]["Authorization"] == "Bearer user-access-token"


def test_analyze_upload_requires_supabase_access_token(client, monkeypatch):
    mock_user_verification(monkeypatch)
    response = client.post(
        "/api/images/analyze",
        files={"photo": ("shirt.png", png_bytes(), "image/png")},
    )
    assert response.status_code == 401


def test_analyze_upload_returns_main9_result_for_valid_image(client, monkeypatch):
    mock_user_verification(monkeypatch, body={"id": "owner-uuid"})
    monkeypatch.setattr(
        api,
        "analyze_uploaded_image",
        lambda data: {
            "success": True,
            "message": "Clothing detected successfully.",
            "items": [{
                "category": "Top",
                "clothing_type": "short_sleeve_top",
                "dominant_color": "Blue",
                "color_family": "Blue",
                "pattern": "solid",
            }],
        },
    )

    response = client.post(
        "/api/images/analyze",
        headers={"Authorization": "Bearer " + "test-token"},
        files={"photo": ("shirt.png", png_bytes(), "image/png")},
    )

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["items"][0]["category"] == "Top"


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
