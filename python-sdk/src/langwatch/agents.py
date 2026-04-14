"""
API facade for managing LangWatch agents via REST API.

Provides CRUD operations for agents with proper error handling.
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
        raise ValueError(f"Agent not found: {detail}" if detail else "Agent not found")
    if status == 400:
        raise ValueError(
            f"Bad request: {detail}" if detail else "Bad request"
        )
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


class AgentsFacade:
    """
    Facade for managing LangWatch agents via REST API.

    Provides list, get, create, update, and delete operations.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "AgentsFacade":
        """Create an AgentsFacade using the global LangWatch configuration."""
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
        page: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        List all agents for the project (paginated).

        Args:
            page: 1-based page number (default: 1).
            limit: Maximum items per page (default: 50).

        Returns:
            Dictionary with 'data' list and 'pagination' metadata.
        """
        params: Dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if limit is not None:
            params["limit"] = limit

        response = self._http().get("/api/agents", params=params)
        _raise_for_status(response, operation="list")
        return response.json()

    def get(self, agent_id: str) -> Dict[str, Any]:
        """
        Retrieve a single agent by ID.

        Args:
            agent_id: The agent ID.

        Returns:
            Dictionary containing the agent data.
        """
        response = self._http().get(f"/api/agents/{_quote(agent_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def create(
        self,
        *,
        name: str,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new agent.

        Args:
            name: Name for the agent.
            config: Optional configuration dictionary.

        Returns:
            Dictionary containing the created agent data.
        """
        body: Dict[str, Any] = {"name": name}
        if config is not None:
            body.update(config)

        response = self._http().post("/api/agents", json=body)
        _raise_for_status(response, operation="create")
        return response.json()

    def update(
        self,
        agent_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Update an existing agent.

        Args:
            agent_id: The agent ID to update.
            params: Dictionary of fields to update.

        Returns:
            Dictionary containing the updated agent data.
        """
        body = params or {}
        response = self._http().patch(
            f"/api/agents/{_quote(agent_id)}", json=body
        )
        _raise_for_status(response, operation="update")
        return response.json()

    def delete(self, agent_id: str) -> Dict[str, Any]:
        """
        Delete (archive) an agent.

        Args:
            agent_id: The agent ID to delete.

        Returns:
            Dictionary with deletion result.
        """
        response = self._http().delete(f"/api/agents/{_quote(agent_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()
