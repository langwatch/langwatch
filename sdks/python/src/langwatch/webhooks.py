"""
API facade for the LangWatch webhook endpoints platform.

Endpoint CRUD (including the per-endpoint delivery controls), the
delivery log, health, test-fire, secret rolling, and the organization's
emitted-events log. All routes are organization-anchored: authenticate
with an organization API key (``sk-lw-...``) via ``langwatch.setup``.
Uses httpx via the generated REST API client for HTTP transport.
"""

from typing import Any, Callable, Dict, Iterator, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.gateway_http import (
    idempotency_headers,
    note_idempotent_replay,
    raise_for_status,
    walk_cursor_pages,
)
from langwatch.utils.initialization import ensure_setup


class WebhooksFacade:
    """Facade for the webhook endpoints platform."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "WebhooksFacade":
        """Build the facade on the process-wide LangWatch client, setting it
        up first if nothing has yet."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError("LangWatch client has not been initialized. Call setup() first.")
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    # ── endpoints ─────────────────────────────────────────────────────

    def list(self) -> List[Dict[str, Any]]:
        """List the organization's webhook endpoints. This route is not
        cursor-paged: one call is the whole set."""
        response = self._http().post("/api/webhooks/endpoints.list")
        raise_for_status(response, operation="list endpoints")
        return response.json()["data"]

    def get(self, endpoint_id: str) -> Dict[str, Any]:
        """Get one endpoint by id."""
        response = self._http().post(
            "/api/webhooks/endpoints.get", json={"id": endpoint_id}
        )
        raise_for_status(response, operation="get endpoint")
        return response.json()["data"]

    def create(
        self,
        *,
        url: str,
        enabled_events: List[str],
        max_batch_size: Optional[int] = None,
        max_batch_delay_ms: Optional[int] = None,
        max_in_flight: Optional[int] = None,
        idempotency_key: Optional[str] = None,
        on_idempotent_replay: Optional[Callable[[], None]] = None,
    ) -> Dict[str, Any]:
        """Create an endpoint. The response carries the signing secret ONCE.

        ``idempotency_key`` makes the create safe to retry. A dropped
        connection after the write looks exactly like a dropped request, and
        retrying without a key mints a SECOND endpoint that also receives every
        delivery. Send the same key again and the server answers with the first
        response, signing secret included, which is the only way to recover a
        secret nothing else ever serves twice. Keys are unique within the
        ORGANIZATION on this surface; receipts answer for 24 hours, and reusing
        a key with a different body is refused rather than answered wrongly.

        ``on_idempotent_replay`` is called when the answer came from a receipt
        rather than a fresh write."""
        body: Dict[str, Any] = {"url": url, "enabled_events": enabled_events}
        if max_batch_size is not None:
            body["max_batch_size"] = max_batch_size
        if max_batch_delay_ms is not None:
            body["max_batch_delay_ms"] = max_batch_delay_ms
        if max_in_flight is not None:
            body["max_in_flight"] = max_in_flight
        response = self._http().post(
            "/api/webhooks/endpoints.create",
            json=body,
            headers=idempotency_headers(idempotency_key),
        )
        raise_for_status(response, operation="create endpoint")
        note_idempotent_replay(response, on_idempotent_replay)
        return response.json()["data"]

    def update(
        self,
        endpoint_id: str,
        *,
        url: Optional[str] = None,
        enabled_events: Optional[List[str]] = None,
        status: Optional[str] = None,
        max_batch_size: Optional[int] = None,
        max_batch_delay_ms: Optional[int] = None,
        max_in_flight: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Partial update: only the fields passed are sent, so an omitted
        one is left alone rather than cleared. ``status`` is active or
        disabled, and re-enabling does not re-send the gap; replay covers
        it."""
        body: Dict[str, Any] = {}
        if url is not None:
            body["url"] = url
        if enabled_events is not None:
            body["enabled_events"] = enabled_events
        if status is not None:
            body["status"] = status
        if max_batch_size is not None:
            body["max_batch_size"] = max_batch_size
        if max_batch_delay_ms is not None:
            body["max_batch_delay_ms"] = max_batch_delay_ms
        if max_in_flight is not None:
            body["max_in_flight"] = max_in_flight
        response = self._http().post(
            "/api/webhooks/endpoints.update", json={"id": endpoint_id, **body}
        )
        raise_for_status(response, operation="update endpoint")
        return response.json()["data"]

    def archive(self, endpoint_id: str) -> None:
        """Retire an endpoint: deliveries stop and it disappears from every
        read, while its delivery history stays readable. The row is archived
        rather than removed, and the response carries only an acknowledgement
        that it was, so there is nothing to hand back."""
        response = self._http().post(
            "/api/webhooks/endpoints.archive", json={"id": endpoint_id}
        )
        raise_for_status(response, operation="archive endpoint")

    def roll_secret(self, endpoint_id: str) -> Dict[str, Any]:
        """Mint a new signing secret. Returned ONCE, like create."""
        response = self._http().post(
            "/api/webhooks/endpoints.rollSecret", json={"id": endpoint_id}
        )
        raise_for_status(response, operation="roll secret")
        return response.json()["data"]

    def test(self, endpoint_id: str) -> Dict[str, Any]:
        """Fire a signed test event at the endpoint and report the outcome.
        The call succeeds whenever the test itself ran, so read ``delivered``
        for the receiver's verdict."""
        response = self._http().post(
            "/api/webhooks/endpoints.test", json={"id": endpoint_id}
        )
        raise_for_status(response, operation="test endpoint")
        return response.json()["data"]

    # ── observability ─────────────────────────────────────────────────

    def deliveries_page(
        self,
        endpoint_id: str,
        *,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """One page of delivery attempts for an endpoint, newest first, with
        the receiver's status per attempt. Returns {data, next_cursor}."""
        body: Dict[str, Any] = {"id": endpoint_id}
        if cursor is not None:
            body["cursor"] = cursor
        if limit is not None:
            body["limit"] = limit
        response = self._http().post(
            "/api/webhooks/endpoints.listDeliveries",
            json=body,
        )
        raise_for_status(response, operation="list deliveries")
        return response.json()

    def iter_deliveries(
        self, endpoint_id: str, *, limit: Optional[int] = None
    ) -> Iterator[Dict[str, Any]]:
        """Every delivery attempt for an endpoint, one at a time, fetching a
        page only when the previous one runs out.

        Lazy on purpose: the log grows with every send, so it is a range to
        walk rather than a collection to hold."""
        for page in walk_cursor_pages(
            lambda cursor: self.deliveries_page(
                endpoint_id, cursor=cursor, limit=limit
            )
        ):
            yield from page["data"]

    def health(self, endpoint_id: str) -> Dict[str, Any]:
        """Send rate, success rate, failure streak, DLQ depth, and the lag
        headline: oldest undelivered age."""
        response = self._http().post(
            "/api/webhooks/endpoints.getHealth", json={"id": endpoint_id}
        )
        raise_for_status(response, operation="endpoint health")
        return response.json()["data"]

    # ── events ────────────────────────────────────────────────────────

    def event_types(self) -> List[Dict[str, Any]]:
        """The subscribable event catalog (type, family, emitting)."""
        response = self._http().post("/api/webhooks/eventTypes.list")
        raise_for_status(response, operation="event types")
        return response.json()["data"]

    def events_page(
        self,
        *,
        from_ms: int,
        to_ms: int,
        type: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """One page of the organization's emitted-events log (Stripe
        /v1/events parity): filter by type over a created range.
        Returns {data, next_cursor}. ``from_ms`` and ``to_ms`` bound the
        created range in epoch milliseconds, named as the spend facade names
        the same wire params because ``from`` is a python keyword. They are
        required: the log is a ranged read over the 13-month spend table, and
        an unbounded walk sorts all of it on every page.

        ``type`` is a single event type, which is all the route filters on.
        An unknown type serves an empty page rather than an error, so a
        consumer can probe forward-compatibly."""
        body: Dict[str, Any] = {"from": from_ms, "to": to_ms}
        if type is not None:
            body["type"] = type
        if cursor is not None:
            body["cursor"] = cursor
        if limit is not None:
            body["limit"] = limit
        response = self._http().post("/api/webhooks/events.list", json=body)
        raise_for_status(response, operation="events log")
        return response.json()

    def iter_events(
        self,
        *,
        from_ms: int,
        to_ms: int,
        type: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Every emitted event matching the filters, one envelope at a time,
        fetching a page only when the previous one runs out.

        Lazy on purpose: the log is a retention window, so it is a range to
        walk rather than a collection to hold."""
        for page in walk_cursor_pages(
            lambda cursor: self.events_page(
                type=type,
                from_ms=from_ms,
                to_ms=to_ms,
                cursor=cursor,
                limit=limit,
            )
        ):
            yield from page["data"]

    def get_event(self, event_id: str) -> Dict[str, Any]:
        """One emitted event by id, exactly as it was delivered. A missing
        event answers not found whatever the reason, since telling never
        emitted apart from past retention would confirm another
        organization's ids."""
        response = self._http().post(
            "/api/webhooks/events.get", json={"id": event_id}
        )
        raise_for_status(response, operation="get event")
        return response.json()["data"]
