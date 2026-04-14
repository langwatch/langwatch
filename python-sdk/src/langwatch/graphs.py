"""
API facade for managing LangWatch graphs via REST API.

Provides CRUD operations for graphs (chart widgets within dashboards)
with proper error handling.
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
            f"Graph not found: {detail}" if detail else "Graph not found"
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


class GraphsFacade:
    """
    Facade for managing LangWatch graphs via REST API.

    Provides list, get, create, update, and delete operations.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "GraphsFacade":
        """Create a GraphsFacade using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def list(
        self,
        *,
        dashboard_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        List graphs, optionally filtered by dashboard.

        Args:
            dashboard_id: Optional dashboard ID to filter graphs by.

        Returns:
            Dictionary with graph data.
        """
        params: Dict[str, Any] = {}
        if dashboard_id is not None:
            params["dashboardId"] = dashboard_id

        response = self._http().get("/api/graphs", params=params)
        _raise_for_status(response, operation="list")
        return response.json()

    def get(self, graph_id: str) -> Dict[str, Any]:
        """
        Retrieve a single graph by ID.

        Args:
            graph_id: The graph ID.

        Returns:
            Dictionary containing the graph data.
        """
        response = self._http().get(f"/api/graphs/{_quote(graph_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def create(
        self,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new graph.

        Args:
            params: Dictionary of graph fields (dashboardId, name, graphType, etc.).

        Returns:
            Dictionary containing the created graph data.
        """
        body = params or {}
        response = self._http().post("/api/graphs", json=body)
        _raise_for_status(response, operation="create")
        return response.json()

    def update(
        self,
        graph_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Update an existing graph.

        Args:
            graph_id: The graph ID to update.
            params: Dictionary of fields to update.

        Returns:
            Dictionary containing the updated graph data.
        """
        body = params or {}
        response = self._http().patch(
            f"/api/graphs/{_quote(graph_id)}", json=body
        )
        _raise_for_status(response, operation="update")
        return response.json()

    def delete(self, graph_id: str) -> Dict[str, Any]:
        """
        Delete a graph.

        Args:
            graph_id: The graph ID to delete.

        Returns:
            Dictionary with deletion result.
        """
        response = self._http().delete(f"/api/graphs/{_quote(graph_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()
