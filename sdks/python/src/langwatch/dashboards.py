"""
API facade for Dashboards at /api/v1/dashboards and the widgets on them.

The project comes from the API key. While Dashboards is switched off for the
key's project, every route answers 404.

Spec: modules/dashboard/specs/dashboards-v2.feature (AC199l to AC199s, AC199w)
"""

import urllib.parse
from typing import Any, Dict, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.exceptions import extract_api_error_detail
from langwatch.utils.initialization import ensure_setup

_UNSET: Any = object()


def _raise_for_status(response: httpx.Response) -> None:
    """Map HTTP error status codes to appropriate exceptions."""
    if response.is_success:
        return

    status = response.status_code
    try:
        detail = extract_api_error_detail(response.json())
    except Exception:
        detail = response.text or ""

    if status == 404:
        raise ValueError(f"Dashboard not found: {detail}" if detail else "Dashboard not found")
    if status in (400, 422):
        raise ValueError(f"Bad request: {detail}" if detail else "Bad request")
    if status == 401:
        raise RuntimeError(
            f"Authentication failed: {detail}" if detail else "Authentication failed"
        )
    if status >= 500:
        raise RuntimeError(
            f"Server error ({status}): {detail}" if detail else f"Server error ({status})"
        )
    raise RuntimeError(f"Unexpected status {status}: {detail}")


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


class DashboardsFacade:
    """Dashboards and their widgets, over /api/v1/dashboards."""

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

    def _send(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        http = self._client.get_httpx_client()
        response = (
            http.request(method, path)
            if body is None
            else http.request(method, path, json=body)
        )
        _raise_for_status(response)
        return response.json() if response.content else None

    # -- dashboards --------------------------------------------------------------

    def list(self) -> Dict[str, Any]:
        """List the dashboards of the key's project, each with its widget count."""
        return self._send("GET", "/api/v1/dashboards")

    def get(self, dashboard_id: str) -> Dict[str, Any]:
        """Read one dashboard."""
        return self._send("GET", f"/api/v1/dashboards/{_quote(dashboard_id)}")

    def create(self, *, name: str) -> Dict[str, Any]:
        """Create an empty dashboard."""
        return self._send("POST", "/api/v1/dashboards", {"name": name})

    def update(
        self,
        dashboard_id: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = _UNSET,
        excluded_origins: Optional[List[str]] = _UNSET,
    ) -> Dict[str, Any]:
        """Change a dashboard's name, description or the trace origins its widgets leave out.

        `description=None` clears it. `excluded_origins=[]` includes Langy's traces,
        `["langy"]` leaves them out and `None` restores the default.
        """
        body: Dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if description is not _UNSET:
            body["description"] = description
        if excluded_origins is not _UNSET:
            body["excludedOrigins"] = excluded_origins
        if not body:
            raise ValueError(
                "Provide at least one of name, description or excluded_origins."
            )
        return self._send("PATCH", f"/api/v1/dashboards/{_quote(dashboard_id)}", body)

    def delete(self, dashboard_id: str) -> Dict[str, Any]:
        """Delete a dashboard with the widgets on it."""
        return self._send("DELETE", f"/api/v1/dashboards/{_quote(dashboard_id)}")

    # -- widgets on a dashboard --------------------------------------------------

    def list_widgets(self, dashboard_id: str) -> Dict[str, Any]:
        """List the widgets on one dashboard."""
        return self._send("GET", f"/api/v1/dashboards/{_quote(dashboard_id)}/widgets")

    def create_widget(
        self,
        dashboard_id: str,
        *,
        name: str,
        code: str,
        queries: List[Dict[str, Any]],
        description: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a widget placed on this dashboard."""
        body: Dict[str, Any] = {"name": name, "code": code, "queries": queries}
        if description is not None:
            body["description"] = description
        if prompt is not None:
            body["prompt"] = prompt
        return self._send("POST", f"/api/v1/dashboards/{_quote(dashboard_id)}/widgets", body)

    def get_widget(self, dashboard_id: str, widget_id: str) -> Dict[str, Any]:
        """Read one widget on this dashboard."""
        return self._send("GET", self._widget_path(dashboard_id, widget_id))

    def update_widget(
        self,
        dashboard_id: str,
        widget_id: str,
        *,
        name: Optional[str] = None,
        code: Optional[str] = None,
        queries: Optional[List[Dict[str, Any]]] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Change a widget on this dashboard; a field left out keeps its value."""
        body = {
            key: value
            for key, value in {
                "name": name,
                "code": code,
                "queries": queries,
                "description": description,
            }.items()
            if value is not None
        }
        if not body:
            raise ValueError("Provide at least one of name, code, queries or description.")
        return self._send("PATCH", self._widget_path(dashboard_id, widget_id), body)

    def delete_widget(self, dashboard_id: str, widget_id: str) -> None:
        """Delete one widget on this dashboard."""
        self._send("DELETE", self._widget_path(dashboard_id, widget_id))

    @staticmethod
    def _widget_path(dashboard_id: str, widget_id: str) -> str:
        return f"/api/v1/dashboards/{_quote(dashboard_id)}/widgets/{_quote(widget_id)}"
