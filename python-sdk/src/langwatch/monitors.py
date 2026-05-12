"""
API facade for managing LangWatch monitors via REST API.

Provides CRUD operations for online evaluation monitors.
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
        raise ValueError(f"Monitor not found: {detail}" if detail else "Monitor not found")
    if status == 400:
        raise ValueError(f"Bad request: {detail}" if detail else "Bad request")
    if status == 401:
        raise RuntimeError(f"Authentication failed: {detail}" if detail else "Authentication failed")
    if status >= 500:
        raise RuntimeError(f"Server error ({status}): {detail}" if detail else f"Server error ({status})")
    raise RuntimeError(f"Unexpected status {status}: {detail}")


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


class MonitorsFacade:
    """Facade for managing LangWatch monitors via REST API."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "MonitorsFacade":
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError("LangWatch client has not been initialized. Call setup() first.")
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def list(self) -> List[Dict[str, Any]]:
        """List all monitors for the project."""
        response = self._http().get("/api/monitors")
        _raise_for_status(response, operation="list")
        return response.json()

    def get(self, monitor_id: str) -> Dict[str, Any]:
        """Get a monitor by ID."""
        response = self._http().get(f"/api/monitors/{_quote(monitor_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def create(
        self,
        *,
        name: str,
        check_type: str,
        execution_mode: str = "ON_MESSAGE",
        sample: float = 1.0,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Create a new monitor."""
        body: Dict[str, Any] = {
            "name": name,
            "checkType": check_type,
            "executionMode": execution_mode,
            "sample": sample,
            **kwargs,
        }
        response = self._http().post("/api/monitors", json=body)
        _raise_for_status(response, operation="create")
        return response.json()

    def update(
        self,
        monitor_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Update a monitor."""
        body = params or {}
        response = self._http().patch(f"/api/monitors/{_quote(monitor_id)}", json=body)
        _raise_for_status(response, operation="update")
        return response.json()

    def toggle(self, monitor_id: str, *, enabled: bool) -> Dict[str, Any]:
        """Enable or disable a monitor."""
        response = self._http().post(
            f"/api/monitors/{_quote(monitor_id)}/toggle",
            json={"enabled": enabled},
        )
        _raise_for_status(response, operation="toggle")
        return response.json()

    def delete(self, monitor_id: str) -> Dict[str, Any]:
        """Delete a monitor."""
        response = self._http().delete(f"/api/monitors/{_quote(monitor_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()
