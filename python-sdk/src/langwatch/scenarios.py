"""
API facade for managing LangWatch scenarios via REST API.

Provides CRUD operations for scenarios with proper error handling.
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
            f"Scenario not found: {detail}" if detail else "Scenario not found"
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


class ScenariosFacade:
    """
    Facade for managing LangWatch scenarios via REST API.

    Provides list, get, create, update, and delete operations.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "ScenariosFacade":
        """Create a ScenariosFacade using the global LangWatch configuration."""
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
        List all scenarios for the project.

        Returns:
            Dictionary with scenario data.
        """
        response = self._http().get("/api/scenarios")
        _raise_for_status(response, operation="list")
        return response.json()

    def get(self, scenario_id: str) -> Dict[str, Any]:
        """
        Retrieve a single scenario by ID.

        Args:
            scenario_id: The scenario ID.

        Returns:
            Dictionary containing the scenario data.
        """
        response = self._http().get(f"/api/scenarios/{_quote(scenario_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def create(
        self,
        *,
        name: str,
        description: Optional[str] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """
        Create a new scenario.

        Args:
            name: Name for the scenario.
            description: Optional description.
            **kwargs: Additional fields to include in the request body.

        Returns:
            Dictionary containing the created scenario data.
        """
        body: Dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        body.update(kwargs)

        response = self._http().post("/api/scenarios", json=body)
        _raise_for_status(response, operation="create")
        return response.json()

    def update(
        self,
        scenario_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Update an existing scenario.

        Args:
            scenario_id: The scenario ID to update.
            params: Dictionary of fields to update.

        Returns:
            Dictionary containing the updated scenario data.
        """
        body = params or {}
        response = self._http().put(
            f"/api/scenarios/{_quote(scenario_id)}", json=body
        )
        _raise_for_status(response, operation="update")
        return response.json()

    def delete(self, scenario_id: str) -> Dict[str, Any]:
        """
        Delete (archive) a scenario.

        Args:
            scenario_id: The scenario ID to delete.

        Returns:
            Dictionary with deletion result.
        """
        response = self._http().delete(f"/api/scenarios/{_quote(scenario_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()
