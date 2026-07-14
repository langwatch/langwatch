"""
API facade for managing LangWatch model providers via REST API.

Provides list and set operations for model providers with proper error handling.
Uses httpx via the generated REST API client for HTTP transport.
"""

import urllib.parse
from typing import Any, Dict, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance


def _raise_for_status(response: httpx.Response, *, operation: str = "") -> None:
    """Map HTTP error status codes to appropriate exceptions."""
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
        raise ValueError(
            f"Model provider not found: {detail}"
            if detail
            else "Model provider not found"
        )
    if status == 400:
        raise ValueError(f"Bad request: {detail}" if detail else "Bad request")
    if status == 401:
        raise RuntimeError(
            f"Authentication failed: {detail}"
            if detail
            else "Authentication failed"
        )
    if status >= 500:
        raise RuntimeError(
            f"Server error ({status}): {detail}"
            if detail
            else f"Server error ({status})"
        )
    raise RuntimeError(f"Unexpected status {status}: {detail}")


def _quote(value: str) -> str:
    """URL-quote a path segment."""
    return urllib.parse.quote(value, safe="")


class ModelProvidersFacade:
    """
    Facade for managing LangWatch model providers via REST API.

    Provides list and set operations.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "ModelProvidersFacade":
        """Create a ModelProvidersFacade using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def list(self) -> Dict[str, Any]:
        """
        List all configured model providers for the project.

        Returns:
            Dictionary with model provider data.
        """
        response = self._http().get("/api/model-providers")
        _raise_for_status(response, operation="list")
        return response.json()

    def set(
        self,
        provider: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Set (create or update) a model provider configuration.

        Args:
            provider: The provider identifier (e.g., "openai", "azure").
            params: Dictionary of provider configuration fields.

        Returns:
            Dictionary containing the updated model provider data.
        """
        body = params or {}
        response = self._http().put(
            f"/api/model-providers/{_quote(provider)}", json=body
        )
        _raise_for_status(response, operation="set")
        return response.json()
