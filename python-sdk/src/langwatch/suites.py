"""
API facade for managing LangWatch suites via REST API.

Provides CRUD operations plus run and duplicate for suites with proper error handling.
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
            f"Suite not found: {detail}" if detail else "Suite not found"
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


class SuitesFacade:
    """
    Facade for managing LangWatch suites via REST API.

    Provides list, get, create, update, run, and delete operations.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "SuitesFacade":
        """Create a SuitesFacade using the global LangWatch configuration."""
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
        List all suites for the project.

        Returns:
            Dictionary with suite data.
        """
        response = self._http().get("/api/suites")
        _raise_for_status(response, operation="list")
        return response.json()

    def get(self, suite_id: str) -> Dict[str, Any]:
        """
        Retrieve a single suite by ID.

        Args:
            suite_id: The suite ID.

        Returns:
            Dictionary containing the suite data.
        """
        response = self._http().get(f"/api/suites/{_quote(suite_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def create(
        self,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new suite.

        Args:
            params: Dictionary of suite fields (name, slug, etc.).

        Returns:
            Dictionary containing the created suite data.
        """
        body = params or {}
        response = self._http().post("/api/suites", json=body)
        _raise_for_status(response, operation="create")
        return response.json()

    def update(
        self,
        suite_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Update an existing suite.

        Args:
            suite_id: The suite ID to update.
            params: Dictionary of fields to update.

        Returns:
            Dictionary containing the updated suite data.
        """
        body = params or {}
        response = self._http().patch(
            f"/api/suites/{_quote(suite_id)}", json=body
        )
        _raise_for_status(response, operation="update")
        return response.json()

    def run(
        self,
        suite_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Trigger a suite run.

        Schedules scenario executions for all active scenarios, targets,
        and repeat count.

        Args:
            suite_id: The suite ID to run.
            params: Optional run parameters (e.g., repeatCount overrides).

        Returns:
            Dictionary containing the run result with batch run ID.
        """
        body = params or {}
        response = self._http().post(
            f"/api/suites/{_quote(suite_id)}/run", json=body
        )
        _raise_for_status(response, operation="run")
        return response.json()

    def delete(self, suite_id: str) -> Dict[str, Any]:
        """
        Delete (archive) a suite.

        Args:
            suite_id: The suite ID to delete.

        Returns:
            Dictionary with deletion result.
        """
        response = self._http().delete(f"/api/suites/{_quote(suite_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()
