"""
API facade for managing LangWatch triggers via REST API.

Provides CRUD operations for triggers with proper error handling.
Uses httpx via the generated REST API client for HTTP transport.
"""

import urllib.parse
from typing import Any

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.exceptions import extract_api_error_detail
from langwatch.utils.initialization import ensure_setup


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
            f"Trigger not found: {detail}" if detail else "Trigger not found"
        )
    if status == 400:
        raise ValueError(f"Bad request: {detail}" if detail else "Bad request")
    if status == 401:
        raise RuntimeError(
            f"Authentication failed: {detail}" if detail else "Authentication failed"
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


class TriggersFacade:
    """
    Facade for managing LangWatch triggers via REST API.

    Provides list, get, create, update and delete operations, the fire
    history (``fires``), ``enable``/``disable`` and ``test_fire``.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "TriggersFacade":
        """Create a TriggersFacade using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def list(self) -> dict[str, Any]:
        """
        List all triggers for the project.

        Returns:
            Dictionary with trigger data.
        """
        response = self._http().get("/api/triggers")
        _raise_for_status(response, operation="list")
        return response.json()

    def list_slack_connections(self) -> "list[dict[str, Any]]":
        """
        List the Slack connections this project can deliver through: its own
        and its organization's. Name one by ``id`` as ``slackIntegrationId``
        in ``actionParams``. Tokens and webhook URLs are never returned.
        """
        response = self._http().get("/api/slack-connections")
        _raise_for_status(response, operation="list_slack_connections")
        return response.json()

    def get(self, trigger_id: str) -> dict[str, Any]:
        """
        Retrieve a single trigger by ID.

        Args:
            trigger_id: The trigger ID.

        Returns:
            Dictionary containing the trigger data.
        """
        response = self._http().get(f"/api/triggers/{_quote(trigger_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def create(
        self,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Create a new trigger.

        Args:
            params: Dictionary of trigger fields, as the REST API takes them:
                ``name``, ``action``, ``actionParams`` (Slack delivers through
                ``slackIntegrationId`` plus ``slackChannelId`` for a bot
                connection), and ``customGraphId`` + ``graphAlert`` for a
                graph alert or ``report`` for a scheduled report.

        Returns:
            Dictionary containing the created trigger data.
        """
        body = params or {}
        response = self._http().post("/api/triggers", json=body)
        _raise_for_status(response, operation="create")
        return response.json()

    def update(
        self,
        trigger_id: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Update an existing trigger.

        Args:
            trigger_id: The trigger ID to update.
            params: Dictionary of fields to update. Credentials read back as
                ``[redacted]``; sending the placeholder back keeps the stored
                value.

        Returns:
            Dictionary containing the updated trigger data.
        """
        body = params or {}
        response = self._http().patch(f"/api/triggers/{_quote(trigger_id)}", json=body)
        _raise_for_status(response, operation="update")
        return response.json()

    def delete(self, trigger_id: str) -> dict[str, Any]:
        """
        Delete (archive) a trigger.

        Args:
            trigger_id: The trigger ID to delete.

        Returns:
            Dictionary with deletion result.
        """
        response = self._http().delete(f"/api/triggers/{_quote(trigger_id)}")
        _raise_for_status(response, operation="delete")
        return response.json()

    def fires(
        self,
        trigger_id: str,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """
        List one page of a trigger's fires, newest first.

        Args:
            trigger_id: The trigger ID.
            cursor: ``nextCursor`` from the previous page, to read the next one.
            limit: Maximum number of fires on the page.

        Returns:
            Dictionary with ``fires`` and ``nextCursor`` (None on the last page).
        """
        query: dict[str, Any] = {}
        if cursor is not None:
            query["cursor"] = cursor
        if limit is not None:
            query["limit"] = limit
        response = self._http().get(
            f"/api/triggers/{_quote(trigger_id)}/fires", params=query
        )
        _raise_for_status(response, operation="fires")
        return response.json()

    def enable(self, trigger_id: str) -> dict[str, Any]:
        """
        Turn a trigger on.

        Args:
            trigger_id: The trigger ID.

        Returns:
            Dictionary containing the updated trigger data.
        """
        response = self._http().post(f"/api/triggers/{_quote(trigger_id)}/enable")
        _raise_for_status(response, operation="enable")
        return response.json()

    def disable(self, trigger_id: str) -> dict[str, Any]:
        """
        Turn a trigger off without deleting it.

        Args:
            trigger_id: The trigger ID.

        Returns:
            Dictionary containing the updated trigger data.
        """
        response = self._http().post(f"/api/triggers/{_quote(trigger_id)}/disable")
        _raise_for_status(response, operation="disable")
        return response.json()

    def test_fire(self, trigger_id: str) -> dict[str, Any]:
        """
        Send a test delivery through the trigger's configured channel.

        Args:
            trigger_id: The trigger ID.

        Returns:
            Dictionary with ``channel``, ``recipientCount``, ``usedDefault``,
            ``missingVariables``, ``errors`` and, for webhooks, ``httpStatus``.
        """
        response = self._http().post(f"/api/triggers/{_quote(trigger_id)}/test-fire")
        _raise_for_status(response, operation="test_fire")
        return response.json()
