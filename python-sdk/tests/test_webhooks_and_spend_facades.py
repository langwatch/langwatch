"""Unit coverage for the webhooks and spend-events facades: every method
hits its route with the right verb and shape, and unwraps the envelope
the REST apps actually serve. Transport is a mounted httpx.MockTransport;
no network, no generated-client coupling beyond get_httpx_client().

Spec: specs/webhooks/webhook-endpoints.feature
      specs/ai-gateway/billing-spend-events.feature
"""

import json
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

from langwatch.spend_events import SpendEventsFacade
from langwatch.webhooks import WebhooksFacade


class FakeRestClient:
    """The one method the facades use from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


def recorder(responses: Dict[Tuple[str, str], Any]):
    calls: List[Tuple[str, str, Optional[Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        body = None
        if request.content:
            body = json.loads(request.content)
        calls.append((request.method, str(request.url), body))
        payload = responses.get(key)
        assert payload is not None, f"unexpected call {key}"
        return httpx.Response(200, json=payload)

    return handler, calls


def test_webhooks_facade_routes_and_envelopes():
    handler, calls = recorder(
        {
            ("GET", "/api/webhooks/v1/endpoints"): {"data": [{"id": "we_1"}]},
            ("POST", "/api/webhooks/v1/endpoints"): {
                "data": {"id": "we_1", "secret": "whsec_x"}
            },
            ("PATCH", "/api/webhooks/v1/endpoints/we_1"): {
                "data": {"id": "we_1", "max_batch_size": 50}
            },
            ("GET", "/api/webhooks/v1/endpoints/we_1/health"): {
                "data": {"oldest_undelivered_age_ms": 0, "dlq_depth": 0}
            },
            ("GET", "/api/webhooks/v1/endpoints/we_1/deliveries"): {
                "data": [],
                "next_cursor": None,
            },
            ("POST", "/api/webhooks/v1/endpoints/we_1/test"): {
                "data": {"delivered": True, "response_status": 200}
            },
            ("GET", "/api/webhooks/v1/event-types"): {
                "data": [{"type": "gateway.request.completed"}]
            },
            ("GET", "/api/webhooks/v1/events"): {"data": [], "next_cursor": None},
        }
    )
    facade = WebhooksFacade(FakeRestClient(handler))

    assert facade.list() == [{"id": "we_1"}]
    created = facade.create(
        url="https://receiver.example/hooks",
        enabled_events=["gateway.request.completed"],
        max_batch_size=25,
        max_batch_delay_ms=500,
        max_in_flight=4,
    )
    assert created["secret"] == "whsec_x"
    create_call = next(c for c in calls if c[0] == "POST" and c[1].endswith("/endpoints"))
    assert create_call[2]["max_batch_size"] == 25
    assert create_call[2]["max_batch_delay_ms"] == 500
    assert create_call[2]["max_in_flight"] == 4

    assert facade.update("we_1", max_batch_size=50)["max_batch_size"] == 50
    assert facade.health("we_1")["dlq_depth"] == 0
    assert facade.deliveries("we_1", limit=10)["data"] == []
    assert facade.test("we_1")["delivered"] is True
    assert facade.event_types()[0]["type"] == "gateway.request.completed"
    assert facade.events(types=["gateway.request.completed"])["data"] == []


def test_spend_facade_routes_and_envelopes():
    handler, calls = recorder(
        {
            ("GET", "/api/gateway/v1/spend-events"): {"data": [], "next_cursor": None},
            ("GET", "/api/gateway/v1/spend-summaries"): {
                "data": [{"key": "vk_1", "event_count": 2, "settled_count": 0}]
            },
            ("POST", "/api/gateway/v1/spend-events/replay"): {
                "data": {"replayed": 2, "endpoint_id": "we_1"}
            },
            ("GET", "/api/gateway/v1/end-users/user/9/spend"): {
                "data": {"end_user_id": "user/9", "caps": []}
            },
            ("POST", "/api/gateway/v1/budgets/b_1/reset"): {
                "budget": {"id": "b_1", "window": "MANUAL"}
            },
            ("POST", "/api/gateway/v1/virtual-keys/vk_1/disable"): {
                "virtual_key": {"id": "vk_1", "status": "disabled"}
            },
            ("POST", "/api/gateway/v1/virtual-keys/vk_1/enable"): {
                "virtual_key": {"id": "vk_1", "status": "active"}
            },
        }
    )
    facade = SpendEventsFacade(FakeRestClient(handler))

    assert facade.list(from_ms=1, to_ms=2, end_user_id="user-9")["data"] == []
    listed = next(c for c in calls if "/spend-events?" in c[1])
    assert "end_user_id=user-9" in listed[1]

    rows = facade.summaries(group_by="virtual_key", from_ms=1, to_ms=2)
    assert rows[0]["settled_count"] == 0

    replayed = facade.replay(from_ms=1, to_ms=2, endpoint_id="we_1")
    assert replayed["replayed"] == 2

    # Path-encodes external ids: end users are caller-supplied strings.
    spend = facade.end_user_spend("user/9")
    assert spend["caps"] == []
    wire = next(c for c in calls if "/end-users/" in c[1])
    assert "user%2F9" in wire[1]

    reset = facade.reset_budget("b_1", reason="period close")
    assert reset["window"] == "MANUAL"
    reset_call = next(c for c in calls if c[1].endswith("/budgets/b_1/reset"))
    assert reset_call[2] == {"reason": "period close"}

    assert facade.disable_virtual_key("vk_1", reason="hold")["status"] == "disabled"
    assert facade.enable_virtual_key("vk_1")["status"] == "active"


def test_errors_surface_operation_and_detail():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": "plan_required"})

    facade = SpendEventsFacade(FakeRestClient(handler))
    with pytest.raises(RuntimeError, match="list spend events"):
        facade.list(from_ms=1, to_ms=2)
