"""Unit coverage for the virtual-keys and gateway-budgets facades: every
method hits its route with the right verb and shape, unwraps the envelope
the REST app actually serves, and carries the project header org keys need.
Transport is a mounted httpx.MockTransport; no network, no generated-client
coupling beyond get_httpx_client().

Webhooks and spend events live in tests/test_webhooks_and_spend_facades.py.

Spec: specs/ai-gateway/virtual-keys.feature
      specs/ai-gateway/gateway-budgets.feature
"""

import json
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

from langwatch.gateway_budgets import GatewayBudgetsFacade
from langwatch.utils.gateway_http import walk_cursor_pages
from langwatch.virtual_keys import VirtualKeysFacade


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


def paged(handler_pages: List[Dict[str, Any]]):
    """A handler that serves the given pages in order, recording cursors."""
    seen_cursors: List[Optional[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_cursors.append(request.url.params.get("cursor"))
        return httpx.Response(200, json=handler_pages[len(seen_cursors) - 1])

    return handler, seen_cursors


def test_virtual_keys_routes_and_envelopes():
    handler, calls = recorder(
        {
            ("POST", "/api/gateway/v1/virtual-keys"): {
                "virtual_key": {"id": "vk_1"},
                "secret": "vk-lw-once",
            },
            ("GET", "/api/gateway/v1/virtual-keys/vk_1"): {
                "virtual_key": {"id": "vk_1", "name": "ACME"}
            },
            ("PATCH", "/api/gateway/v1/virtual-keys/vk_1"): {
                "virtual_key": {"id": "vk_1", "name": "ACME renamed"}
            },
            ("POST", "/api/gateway/v1/virtual-keys/vk_1/rotate"): {
                "virtual_key": {"id": "vk_1"},
                "secret": "vk-lw-rotated",
            },
            ("POST", "/api/gateway/v1/virtual-keys/vk_1/revoke"): {
                "virtual_key": {"id": "vk_1", "status": "revoked"}
            },
            ("POST", "/api/gateway/v1/virtual-keys/vk_1/disable"): {
                "virtual_key": {"id": "vk_1", "status": "disabled"}
            },
            ("POST", "/api/gateway/v1/virtual-keys/vk_1/enable"): {
                "virtual_key": {"id": "vk_1", "status": "active"}
            },
            ("GET", "/api/gateway/v1/virtual-keys/vk_1/spend"): {
                "virtual_key_id": "vk_1",
                "spent_usd": "1.50",
                "requests": 3,
            },
        }
    )
    facade = VirtualKeysFacade(FakeRestClient(handler), project_id="proj_9")

    # create and rotate hand back the whole body: the secret rides beside
    # the key and is served exactly once.
    minted = facade.create(name="ACME Corp", description="rebilling tenant")
    assert minted["secret"] == "vk-lw-once"
    assert minted["virtual_key"]["id"] == "vk_1"
    create_call = next(c for c in calls if c[0] == "POST" and c[1].endswith("/virtual-keys"))
    assert create_call[2] == {"name": "ACME Corp", "description": "rebilling tenant"}

    assert facade.get("vk_1")["name"] == "ACME"
    assert facade.update("vk_1", name="ACME renamed")["name"] == "ACME renamed"
    assert facade.rotate("vk_1")["secret"] == "vk-lw-rotated"
    assert facade.revoke("vk_1")["status"] == "revoked"
    assert facade.disable("vk_1", reason="hold")["status"] == "disabled"
    assert facade.enable("vk_1")["status"] == "active"

    disable_call = next(c for c in calls if c[1].endswith("/disable"))
    assert disable_call[2] == {"reason": "hold"}

    assert facade.spend("vk_1", from_ms=1, to_ms=2)["requests"] == 3
    spend_call = next(c for c in calls if "/spend" in c[1])
    assert "from=1" in spend_call[1] and "to=2" in spend_call[1]


def test_virtual_keys_list_follows_the_cursor_to_exhaustion():
    """The route pages at a server default of 50, so a single request is a
    prefix of the answer, not the answer.

    A short page proves nothing either: the server filters each page for
    visibility after reading it, so only a null next_cursor ends the walk.
    """
    handler, seen_cursors = paged(
        [
            {"data": [{"id": "vk_1"}], "next_cursor": "c1"},
            {"data": [{"id": "vk_2"}, {"id": "vk_3"}], "next_cursor": "c2"},
            {"data": [{"id": "vk_4"}], "next_cursor": None},
        ]
    )
    facade = VirtualKeysFacade(FakeRestClient(handler))

    keys = facade.list()
    assert [k["id"] for k in keys] == ["vk_1", "vk_2", "vk_3", "vk_4"]
    assert seen_cursors == [None, "c1", "c2"]


def test_virtual_keys_iterate_yields_across_pages():
    handler, seen_cursors = paged(
        [
            {"data": [{"id": "vk_1"}], "next_cursor": "c1"},
            {"data": [{"id": "vk_2"}], "next_cursor": None},
        ]
    )
    facade = VirtualKeysFacade(FakeRestClient(handler))

    walk = facade.iterate(limit=1)
    # Lazy: nothing is fetched until the first row is pulled.
    assert seen_cursors == []
    assert next(walk)["id"] == "vk_1"
    assert seen_cursors == [None]
    assert [k["id"] for k in walk] == ["vk_2"]
    assert seen_cursors == [None, "c1"]


def test_budgets_routes_and_envelopes():
    handler, calls = recorder(
        {
            ("POST", "/api/gateway/v1/budgets"): {"budget": {"id": "b_1"}},
            ("GET", "/api/gateway/v1/budgets/b_1"): {
                "budget": {"id": "b_1", "window": "month"},
                "spend_available": True,
            },
            ("PATCH", "/api/gateway/v1/budgets/b_1"): {
                "budget": {"id": "b_1", "limit_usd": "5.00"}
            },
            ("DELETE", "/api/gateway/v1/budgets/b_1"): {
                "budget": {"id": "b_1", "archived_at": "2026-01-01T00:00:00Z"}
            },
            ("POST", "/api/gateway/v1/budgets/b_1/reset"): {
                "budget": {"id": "b_1", "window": "manual"}
            },
        }
    )
    facade = GatewayBudgetsFacade(FakeRestClient(handler), project_id="proj_9")

    budget = facade.create(
        scope={"kind": "attributed_user", "anchor_virtual_key_id": "vk_1"},
        name="per-user",
        window="month",
        limit_usd="1.00",
    )
    assert budget["id"] == "b_1"

    assert facade.get("b_1")["window"] == "month"
    assert facade.update("b_1", limit_usd="5.00")["limit_usd"] == "5.00"
    assert facade.archive("b_1")["archived_at"] == "2026-01-01T00:00:00Z"

    reset = facade.reset("b_1", end_user_id="user/9", reason="period close")
    assert reset["window"] == "manual"
    reset_call = next(c for c in calls if "/budgets/b_1/reset" in c[1])
    assert reset_call[2] == {"reason": "period close"}
    assert "end_user_id=user%2F9" in reset_call[1]


def test_budgets_list_ands_spend_available_across_pages():
    """spend_available is a correctness flag, not a per-page detail.

    One page that could not total spend makes the whole answer say so,
    because a null spent_usd anywhere in the walk cannot be told apart from
    zero spend without it.
    """
    handler, seen_cursors = paged(
        [
            {"data": [{"id": "b_1"}], "spend_available": True, "next_cursor": "c1"},
            {"data": [{"id": "b_2"}], "spend_available": False, "next_cursor": "c2"},
            {"data": [{"id": "b_3"}], "spend_available": True, "next_cursor": None},
        ]
    )
    facade = GatewayBudgetsFacade(FakeRestClient(handler))

    listed = facade.list()
    assert [b["id"] for b in listed["data"]] == ["b_1", "b_2", "b_3"]
    assert listed["spend_available"] is False
    assert seen_cursors == [None, "c1", "c2"]


def test_budgets_list_keeps_spend_available_true_when_every_page_totalled():
    handler, _ = paged(
        [
            {"data": [{"id": "b_1"}], "spend_available": True, "next_cursor": "c1"},
            {"data": [{"id": "b_2"}], "spend_available": True, "next_cursor": None},
        ]
    )
    facade = GatewayBudgetsFacade(FakeRestClient(handler))

    assert facade.list()["spend_available"] is True


def test_budgets_iterate_sends_the_scope_filter_and_walks_pages():
    pages = [
        {"data": [{"id": "b_1"}], "spend_available": True, "next_cursor": "c1"},
        {"data": [{"id": "b_2"}], "spend_available": True, "next_cursor": None},
    ]
    seen: List[Tuple[Optional[str], Optional[str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(
            (
                request.url.params.get("scope_type"),
                request.url.params.get("cursor"),
            )
        )
        return httpx.Response(200, json=pages[len(seen) - 1])

    facade = GatewayBudgetsFacade(FakeRestClient(handler))
    rows = list(facade.iterate(scope_types=["virtual_key", "attributed_user"]))

    assert [b["id"] for b in rows] == ["b_1", "b_2"]
    assert seen == [
        ("virtual_key,attributed_user", None),
        ("virtual_key,attributed_user", "c1"),
    ]


def test_project_header_rides_every_gateway_call():
    seen_headers: List[Optional[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(request.headers.get("X-Project-Id"))
        return httpx.Response(
            200,
            json={
                "data": [],
                "next_cursor": None,
                "spend_available": True,
                "virtual_key": {},
                "budget": {},
            },
        )

    virtual_keys = VirtualKeysFacade(FakeRestClient(handler), project_id="proj_9")
    budgets = GatewayBudgetsFacade(FakeRestClient(handler), project_id="proj_9")

    virtual_keys.list()
    virtual_keys.get("vk_1")
    virtual_keys.disable("vk_1")
    budgets.list()
    budgets.get("b_1")
    budgets.reset("b_1")

    assert seen_headers == ["proj_9"] * 6


def test_walk_cursor_pages_refuses_a_cursor_served_twice():
    """A repeated cursor walks the same page forever, so it raises rather
    than looping or stopping quietly."""
    calls: List[Optional[str]] = []

    def fetch_page(cursor: Optional[str]) -> Dict[str, Any]:
        calls.append(cursor)
        return {"data": [{"id": len(calls)}], "next_cursor": "same"}

    with pytest.raises(RuntimeError, match="same page cursor twice"):
        list(walk_cursor_pages(fetch_page))

    # First page issues "same", the second is served it and returns it again.
    assert calls == [None, "same"]


def test_walk_cursor_pages_stops_on_a_null_cursor():
    def fetch_page(cursor: Optional[str]) -> Dict[str, Any]:
        if cursor is None:
            return {"data": [{"id": 1}], "next_cursor": "c1"}
        return {"data": [{"id": 2}], "next_cursor": None}

    pages = list(walk_cursor_pages(fetch_page))
    assert [p["data"][0]["id"] for p in pages] == [1, 2]
