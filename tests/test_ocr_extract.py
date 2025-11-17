import io
from typing import List
import pytest
from fastapi.testclient import TestClient

# Import the FastAPI app from your backend
from eco_backend import app
import eco_backend

try:
    from PIL import Image
except Exception:
    Image = None

client = TestClient(app)


def _jpeg_bytes(w: int = 64, h: int = 64, color=(255, 255, 255)) -> bytes:
    """Create a tiny in-memory JPEG image."""
    assert Image is not None, "Pillow is required for these tests"
    im = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    im.save(buf, format="JPEG")
    return buf.getvalue()


def test_ocr_json_single_image(monkeypatch):
    """JSON mode: single 'file' upload returns OCR text and lang."""
    # Avoid depending on real Tesseract: stub the OCR result
    monkeypatch.setattr(
        eco_backend.pytesseract,
        "image_to_string",
        lambda img, lang=None: "hello world",
        raising=True,
    )

    img = _jpeg_bytes()
    files = {"file": ("test.jpg", img, "image/jpeg")}
    resp = client.post("/ocr_extract", files=files)  # default: return_pdf=false
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data.get("text") == "hello world"
    assert "lang_used" in data
    assert data.get("filename") == "test.jpg"


def test_pdf_assembly_multiple_images():
    """PDF mode: multiple 'files[]' uploads return a combined PDF."""
    img1 = _jpeg_bytes(80, 80, (255, 255, 255))
    img2 = _jpeg_bytes(80, 80, (220, 220, 220))

    files: List[tuple] = [
        ("files", ("p1.jpg", img1, "image/jpeg")),
        ("files", ("p2.jpg", img2, "image/jpeg")),
    ]
    resp = client.post("/ocr_extract?return_pdf=true", files=files)
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("content-type") == "application/pdf"
    # Should stream a non-empty PDF
    assert resp.content and len(resp.content) > 1000
    # Filename header present
    cd = resp.headers.get("content-disposition", "")
    assert ".pdf" in cd.lower()


def test_rejects_too_large_file():
    """Guard: >10MB should be rejected with 413."""
    # Create >10MB dummy payload (not a real image; size check occurs before decode)
    big = b"\xff" * (10 * 1024 * 1024 + 1)
    files = {"file": ("big.jpg", big, "image/jpeg")}
    resp = client.post("/ocr_extract", files=files)
    assert resp.status_code == 413
    assert "too large" in resp.text.lower()


def test_no_files_returns_400():
    """Guard: no files at all."""
    resp = client.post("/ocr_extract")
    assert resp.status_code == 400
    assert "no image files" in resp.text.lower()

