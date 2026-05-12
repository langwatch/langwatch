"""
API facade for querying LangWatch traces via REST API.

Provides get and search operations for traces with proper error handling.
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
            f"Trace not found: {detail}" if detail else "Trace not found"
        )
    if status == 400:
        raise ValueError(f"Bad request: {detail}" if detail else "Bad request")
    if status == 401:
        raise RuntimeError(
            f"Authentication failed: {detail}"
            if detail
            else "Authentication failed"
        )
    if status == 422:
        raise ValueError(
            f"Validation error: {detail}" if detail else "Validation error"
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


class TracesFacade:
    """
    Facade for querying LangWatch traces via REST API.

    Provides get and search operations.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "TracesFacade":
        """Create a TracesFacade using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def get(self, trace_id: str) -> Dict[str, Any]:
        """
        Retrieve a single trace by its trace ID.

        Args:
            trace_id: The trace ID.

        Returns:
            Dictionary containing the trace data with spans.
        """
        response = self._http().get(f"/api/traces/{_quote(trace_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def search(
        self,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Search traces with filters and pagination.

        Args:
            params: Dictionary of search parameters including:
                - query: Optional text query.
                - filters: Optional filter conditions.
                - pageOffset: Pagination offset.
                - pageSize: Number of results per page.
                - sortBy: Field to sort by.
                - sortDirection: 'asc' or 'desc'.

        Returns:
            Dictionary containing the search results with traces and pagination.
        """
        body = params or {}
        response = self._http().post("/api/traces/search", json=body)
        _raise_for_status(response, operation="search")
        return response.json()
