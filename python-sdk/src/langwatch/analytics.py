"""
API facade for querying LangWatch analytics via REST API.

Provides timeseries analytics queries with proper error handling.
Uses httpx via the generated REST API client for HTTP transport.
"""

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


class AnalyticsFacade:
    """
    Facade for querying LangWatch analytics via REST API.

    Provides timeseries analytics queries.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "AnalyticsFacade":
        """Create an AnalyticsFacade using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def timeseries(
        self,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Query analytics timeseries data with metrics, aggregations, and filters.

        Args:
            params: Dictionary of query parameters including:
                - startDate: Start of the time range (ISO 8601 or epoch ms).
                - endDate: End of the time range.
                - metrics: List of metric definitions.
                - filters: Optional filter conditions.
                - granularity: Time bucket size (e.g., "hour", "day").

        Returns:
            Dictionary containing the timeseries result data.
        """
        body = params or {}
        response = self._http().post("/api/analytics/timeseries", json=body)
        _raise_for_status(response, operation="timeseries")
        return response.json()
