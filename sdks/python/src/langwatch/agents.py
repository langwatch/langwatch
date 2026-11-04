"""
API facade for managing LangWatch agents via REST API.

Provides CRUD operations for agents with proper error handling.
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


def _version_params(
    *, label: Optional[str], version: Optional[int]
) -> Dict[str, Any]:
    """The label and version query parameters; neither reads the latest."""
    params: Dict[str, Any] = {}
    if label is not None:
        params["label"] = label
    if version is not None:
        params["version"] = version
    return params


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

        response = self._http().get("/api/v1/agents", params=params)
        _raise_for_status(response, operation="list")
        return response.json()

    def get(
        self,
        agent_id: str,
        *,
        label: Optional[str] = None,
        version: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Retrieve a single agent by ID, at the latest version unless a label or a version is given.

        Args:
            agent_id: The agent ID. Also takes a suffix: "agent_1:production" or "agent_1:3".
            label: A deploy label, such as "production", to read the version it points at.
            version: A version number to read.

        Returns:
            Dictionary containing the agent data.
        """
        response = self._http().get(
            f"/api/v1/agents/{_quote(agent_id)}",
            params=_version_params(label=label, version=version),
        )
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

        response = self._http().post("/api/v1/agents", json=body)
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
            f"/api/v1/agents/{_quote(agent_id)}", json=body
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
        response = self._http().delete(f"/api/v1/agents/{_quote(agent_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()

    def list_versions(self, agent_id: str) -> Dict[str, Any]:
        """
        List an agent's versions, newest first, with the deploy labels on each.

        Returns:
            Dictionary with a 'data' list of versions and the 'labels' with their versions.
        """
        response = self._http().get(f"/api/v1/agents/{_quote(agent_id)}/versions")
        _raise_for_status(response, operation="list versions")
        return response.json()

    def assign_label(self, agent_id: str, label: str, version: int) -> Dict[str, Any]:
        """Point a deploy label, such as "production", at one of the agent's versions."""
        response = self._http().put(
            f"/api/v1/agents/{_quote(agent_id)}/labels/{_quote(label)}",
            json={"version": version},
        )
        _raise_for_status(response, operation="assign label")
        return response.json()

    def remove_label(self, agent_id: str, label: str) -> Dict[str, Any]:
        """Remove a deploy label from the agent."""
        response = self._http().delete(
            f"/api/v1/agents/{_quote(agent_id)}/labels/{_quote(label)}"
        )
        _raise_for_status(response, operation="remove label")
        return response.json()
