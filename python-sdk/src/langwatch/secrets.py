"""
API facade for managing LangWatch project secrets via REST API.

Provides CRUD operations for encrypted environment variables.
Uses httpx via the generated REST API client for HTTP transport.
"""

import urllib.parse
from typing import Any, Dict, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance


def _raise_for_status(response: httpx.Response, *, operation: str = "") -> None:
    if response.is_success:
        return
    status = response.status_code
    detail = ""
    try:
        body = response.json()
        detail = body.get("message") or body.get("error") or ""
    except Exception:
        detail = response.text or ""
    if status == 404:
        raise ValueError(f"Secret not found: {detail}" if detail else "Secret not found")
    if status == 401:
        raise RuntimeError(f"Authentication failed: {detail}" if detail else "Authentication failed")
    if status >= 500:
        raise RuntimeError(f"Server error ({status}): {detail}" if detail else f"Server error ({status})")
    raise RuntimeError(f"Unexpected status {status}: {detail}")


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


class SecretsFacade:
    """Facade for managing LangWatch project secrets via REST API."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "SecretsFacade":
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError("LangWatch client has not been initialized. Call setup() first.")
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def list(self) -> List[Dict[str, Any]]:
        """List all secrets for the project (values are never returned)."""
        response = self._http().get("/api/secrets")
        _raise_for_status(response, operation="list")
        return response.json()

    def get(self, secret_id: str) -> Dict[str, Any]:
        """Get a secret by ID (value is never returned)."""
        response = self._http().get(f"/api/secrets/{_quote(secret_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def create(self, *, name: str, value: str) -> Dict[str, Any]:
        """
        Create a new secret.

        Args:
            name: Secret name (UPPER_SNAKE_CASE).
            value: Secret value (will be encrypted server-side).
        """
        response = self._http().post("/api/secrets", json={"name": name, "value": value})
        _raise_for_status(response, operation="create")
        return response.json()

    def update(self, secret_id: str, *, value: str) -> Dict[str, Any]:
        """Update a secret's value."""
        response = self._http().put(
            f"/api/secrets/{_quote(secret_id)}",
            json={"value": value},
        )
        _raise_for_status(response, operation="update")
        return response.json()

    def delete(self, secret_id: str) -> Dict[str, Any]:
        """Delete a secret."""
        response = self._http().delete(f"/api/secrets/{_quote(secret_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()
