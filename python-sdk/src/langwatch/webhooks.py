"""
API facade for the LangWatch webhook endpoints platform.

Endpoint CRUD (including the per-endpoint delivery controls), the
delivery log, health, test-fire, secret rolling, and the organization's
emitted-events log. All routes are organization-anchored: authenticate
with an organization API key (``sk-lw-...``) via ``langwatch.setup``.
Uses httpx via the generated REST API client for HTTP transport.
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


def _raise_for_status(response: httpx.Response, *, operation: str = "") -> None:
    if response.is_success:
        return
    status = response.status_code
    detail = ""
    try:
        body = response.json()
        detail = extract_api_error_detail(body)
    except Exception:
        detail = response.text or ""
    label = f"{operation}: " if operation else ""
    if status == 404:
        raise ValueError(f"{label}webhook endpoint not found" + (f": {detail}" if detail else ""))
    if status == 400 or status == 422:
        raise ValueError(f"{label}bad request" + (f": {detail}" if detail else ""))
    if status == 401 or status == 403:
        raise RuntimeError(f"{label}authentication failed" + (f": {detail}" if detail else ""))
    if status >= 500:
        raise RuntimeError(f"{label}server error ({status})" + (f": {detail}" if detail else ""))
    raise RuntimeError(f"{label}unexpected status {status}" + (f": {detail}" if detail else ""))


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


class WebhooksFacade:
    """Facade for the webhook endpoints platform."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "WebhooksFacade":
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError("LangWatch client has not been initialized. Call setup() first.")
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    # ── endpoints ─────────────────────────────────────────────────────

    def list(self) -> List[Dict[str, Any]]:
        """List the organization's webhook endpoints."""
        response = self._http().get("/api/webhooks/v1/endpoints")
        _raise_for_status(response, operation="list endpoints")
        return response.json()["data"]

    def get(self, endpoint_id: str) -> Dict[str, Any]:
        """Get one endpoint by id."""
        response = self._http().get(f"/api/webhooks/v1/endpoints/{_quote(endpoint_id)}")
        _raise_for_status(response, operation="get endpoint")
        return response.json()["data"]

    def create(
        self,
        *,
        url: str,
        enabled_events: List[str],
        description: Optional[str] = None,
        max_batch_size: Optional[int] = None,
        max_batch_delay_ms: Optional[int] = None,
        max_in_flight: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Create an endpoint. The response carries the signing secret ONCE."""
        body: Dict[str, Any] = {"url": url, "enabled_events": enabled_events}
        if description is not None:
            body["description"] = description
        if max_batch_size is not None:
            body["max_batch_size"] = max_batch_size
        if max_batch_delay_ms is not None:
            body["max_batch_delay_ms"] = max_batch_delay_ms
        if max_in_flight is not None:
            body["max_in_flight"] = max_in_flight
        response = self._http().post("/api/webhooks/v1/endpoints", json=body)
        _raise_for_status(response, operation="create endpoint")
        return response.json()["data"]

    def update(self, endpoint_id: str, **fields: Any) -> Dict[str, Any]:
        """Partial update: url, enabled_events, description, status
        (ACTIVE | DISABLED), and the delivery controls (max_batch_size,
        max_batch_delay_ms, max_in_flight, each within server bounds)."""
        response = self._http().patch(
            f"/api/webhooks/v1/endpoints/{_quote(endpoint_id)}", json=fields
        )
        _raise_for_status(response, operation="update endpoint")
        return response.json()["data"]

    def delete(self, endpoint_id: str) -> None:
        """Archive an endpoint; deliveries stop, history stays readable."""
        response = self._http().delete(
            f"/api/webhooks/v1/endpoints/{_quote(endpoint_id)}"
        )
        _raise_for_status(response, operation="delete endpoint")

    def roll_secret(self, endpoint_id: str) -> Dict[str, Any]:
        """Mint a new signing secret. Returned ONCE, like create."""
        response = self._http().post(
            f"/api/webhooks/v1/endpoints/{_quote(endpoint_id)}/roll-secret"
        )
        _raise_for_status(response, operation="roll secret")
        return response.json()["data"]

    def test(self, endpoint_id: str) -> Dict[str, Any]:
        """Fire a signed test event at the endpoint and report the outcome."""
        response = self._http().post(
            f"/api/webhooks/v1/endpoints/{_quote(endpoint_id)}/test"
        )
        _raise_for_status(response, operation="test endpoint")
        return response.json()["data"]

    # ── observability ─────────────────────────────────────────────────

    def deliveries(
        self,
        endpoint_id: str,
        *,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Delivery attempts for one endpoint, newest first, with the
        receiver's status per attempt. Returns {data, next_cursor}."""
        params: Dict[str, Any] = {}
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        response = self._http().get(
            f"/api/webhooks/v1/endpoints/{_quote(endpoint_id)}/deliveries",
            params=params,
        )
        _raise_for_status(response, operation="list deliveries")
        return response.json()

    def health(self, endpoint_id: str) -> Dict[str, Any]:
        """Send rate, success rate, failure streak, DLQ depth, and the lag
        headline: oldest undelivered age."""
        response = self._http().get(
            f"/api/webhooks/v1/endpoints/{_quote(endpoint_id)}/health"
        )
        _raise_for_status(response, operation="endpoint health")
        return response.json()["data"]

    # ── events ────────────────────────────────────────────────────────

    def event_types(self) -> List[Dict[str, Any]]:
        """The subscribable event catalog (type, family, emitting)."""
        response = self._http().get("/api/webhooks/v1/event-types")
        _raise_for_status(response, operation="event types")
        return response.json()["data"]

    def events(
        self,
        *,
        types: Optional[List[str]] = None,
        created_from: Optional[int] = None,
        created_to: Optional[int] = None,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """The organization's emitted-events log (Stripe /v1/events
        parity): filter by type and created range, cursor-paged.
        Returns {data, next_cursor}."""
        params: Dict[str, Any] = {}
        if types:
            params["type"] = ",".join(types)
        if created_from is not None:
            params["from"] = created_from
        if created_to is not None:
            params["to"] = created_to
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        response = self._http().get("/api/webhooks/v1/events", params=params)
        _raise_for_status(response, operation="events log")
        return response.json()
