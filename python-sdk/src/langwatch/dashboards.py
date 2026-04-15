"""
API facade for managing LangWatch dashboards via REST API.

Provides list, get, create, rename, and delete operations for dashboards
with proper error handling.
Uses httpx via the generated REST API client for HTTP transport.
"""

import urllib.parse
from typing import Any, Dict

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
            f"Dashboard not found: {detail}" if detail else "Dashboard not found"
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


class DashboardsFacade:
    """
    Facade for managing LangWatch dashboards via REST API.

    Provides list, get, create, rename, and delete operations.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "DashboardsFacade":
        """Create a DashboardsFacade using the global LangWatch configuration."""
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
        List all dashboards for the project.

        Returns:
            Dictionary with dashboard data.
        """
        response = self._http().get("/api/dashboards")
        _raise_for_status(response, operation="list")
        return response.json()

    def get(self, dashboard_id: str) -> Dict[str, Any]:
        """
        Retrieve a single dashboard by ID.

        Args:
            dashboard_id: The dashboard ID.

        Returns:
            Dictionary containing the dashboard data.
        """
        response = self._http().get(f"/api/dashboards/{_quote(dashboard_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def create(
        self,
        *,
        name: str,
    ) -> Dict[str, Any]:
        """
        Create a new dashboard.

        Args:
            name: Name for the dashboard.

        Returns:
            Dictionary containing the created dashboard data.
        """
        body: Dict[str, Any] = {"name": name}
        response = self._http().post("/api/dashboards", json=body)
        _raise_for_status(response, operation="create")
        return response.json()

    def rename(
        self,
        dashboard_id: str,
        *,
        name: str,
    ) -> Dict[str, Any]:
        """
        Rename an existing dashboard.

        Args:
            dashboard_id: The dashboard ID to rename.
            name: New name for the dashboard.

        Returns:
            Dictionary containing the updated dashboard data.
        """
        body: Dict[str, Any] = {"name": name}
        response = self._http().patch(
            f"/api/dashboards/{_quote(dashboard_id)}", json=body
        )
        _raise_for_status(response, operation="rename")
        return response.json()

    def delete(self, dashboard_id: str) -> Dict[str, Any]:
        """
        Delete a dashboard.

        Args:
            dashboard_id: The dashboard ID to delete.

        Returns:
            Dictionary with deletion result.
        """
        response = self._http().delete(f"/api/dashboards/{_quote(dashboard_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()
