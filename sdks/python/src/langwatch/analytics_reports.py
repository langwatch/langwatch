"""
API facade for Analytics Reports at /api/v1/analytics/reports.

These are the Analytics Reports, not the Dashboards (those are
`langwatch.dashboards`, at /api/v1/dashboards). Provides list, get,
create, rename, and delete operations with proper error handling.
Uses httpx via the generated REST API client for HTTP transport.

Spec: modules/dashboard/specs/dashboards-v2.feature (AC199w)
"""

import urllib.parse
from typing import Any, Dict

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance
from langwatch.utils.exceptions import extract_api_error_detail


def _raise_for_status(response: httpx.Response, *, operation: str = "") -> None:
    """Map HTTP error status codes to appropriate exceptions."""
    if response.is_success:
        return

    status = response.status_code
    detail = ""
    try:
        body = response.json()
        detail = extract_api_error_detail(body)
    except Exception:
        detail = response.text or ""

    if status == 404:
        raise ValueError(
            f"Analytics report not found: {detail}" if detail else "Analytics report not found"
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


class AnalyticsReportsFacade:
    """
    Facade for Analytics Reports via REST API.

    Provides list, get, create, rename, and delete operations.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "AnalyticsReportsFacade":
        """Create a AnalyticsReportsFacade using the global LangWatch configuration."""
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
        List all Analytics Reports for the project.

        Returns:
            Dictionary with Analytics Reports data.
        """
        response = self._http().get("/api/v1/analytics/reports")
        _raise_for_status(response, operation="list")
        return response.json()

    def get(self, report_id: str) -> Dict[str, Any]:
        """
        Retrieve a single Analytics Report by ID.

        Args:
            report_id: The Analytics Report ID.

        Returns:
            Dictionary containing the Analytics Report data.
        """
        response = self._http().get(f"/api/v1/analytics/reports/{_quote(report_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def create(
        self,
        *,
        name: str,
    ) -> Dict[str, Any]:
        """
        Create a new Analytics Report.

        Args:
            name: Name for the Analytics Report.

        Returns:
            Dictionary containing the created Analytics Report data.
        """
        body: Dict[str, Any] = {"name": name}
        response = self._http().post("/api/v1/analytics/reports", json=body)
        _raise_for_status(response, operation="create")
        return response.json()

    def rename(
        self,
        report_id: str,
        *,
        name: str,
    ) -> Dict[str, Any]:
        """
        Rename an existing Analytics Report.

        Args:
            report_id: The Analytics Report ID to rename.
            name: New name for the Analytics Report.

        Returns:
            Dictionary containing the updated Analytics Report data.
        """
        body: Dict[str, Any] = {"name": name}
        response = self._http().patch(
            f"/api/v1/analytics/reports/{_quote(report_id)}", json=body
        )
        _raise_for_status(response, operation="rename")
        return response.json()

    def delete(self, report_id: str) -> Dict[str, Any]:
        """
        Delete an Analytics Report.

        Args:
            report_id: The Analytics Report ID to delete.

        Returns:
            Dictionary with deletion result.
        """
        response = self._http().delete(f"/api/v1/analytics/reports/{_quote(report_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()
