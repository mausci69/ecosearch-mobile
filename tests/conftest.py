import pytest
from fastapi.testclient import TestClient
from eco_backend import app

@pytest.fixture(scope="session")
def client() -> TestClient:
    """Provide a shared TestClient for backend API tests."""
    return TestClient(app)

