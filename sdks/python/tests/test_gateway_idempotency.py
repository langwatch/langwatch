"""Retrying a create is the one retry a caller cannot make safe alone: a
dropped connection after the write looks exactly like a dropped request, and
sending it again mints a second key, budget or endpoint. ``idempotency_key``
is how the caller says "these two are the same request", and it is worth
nothing unless the SDK actually puts it on the wire.

All three creates are exercised here rather than once per facade, because the
failure this guards against is one surface quietly not sending it. The
``external_id`` filter is here too, for the same reason in reverse: a filter
dropped after the first page silently widens the answer.

Spec: specs/ai-gateway/idempotency.feature

Transport is a mounted httpx.MockTransport; no network.
"""

from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

from langwatch.gateway_budgets import GatewayBudgetsFacade
from langwatch.utils.gateway_http import (
    IDEMPOTENCY_KEY_HEADER,
    IDEMPOTENT_REPLAY_HEADER,
)
from langwatch.virtual_keys import VirtualKeysFacade
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


def capturing(payload: Dict[str, Any], *, replayed_after_first: bool = False):
    """Serves one payload, recording the headers of every request.

    With ``replayed_after_first`` every answer past the first carries the
    replay header, which is how the control plane says it answered from a
    receipt rather than writing again.
    """
    seen: List[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers)
        headers = (
            {IDEMPOTENT_REPLAY_HEADER: "true"}
            if replayed_after_first and len(seen) > 1
            else {}
        )
        return httpx.Response(201, json=payload, headers=headers)

    return handler, seen


# (label, response payload, create callable taking the facade and kwargs)
CREATES = [
    (
        "virtual keys",
        {"virtual_key": {"id": "vk_1"}, "secret": "sk-vk-1"},
        lambda client, **kw: VirtualKeysFacade(client).create(name="checkout", **kw),
    ),
    (
        "gateway budgets",
        {"budget": {"id": "bg_1"}},
        lambda client, **kw: GatewayBudgetsFacade(client).create(
            scope={"kind": "project", "project_id": "p_1"},
            name="monthly",
            window="month",
            limit_usd="10",
            **kw,
        ),
    ),
    (
        "webhook endpoints",
        {"data": {"id": "we_1", "secret": "whsec_1"}},
        lambda client, **kw: WebhooksFacade(client).create(
            url="https://acme.example/hooks", enabled_events=["a"], **kw
        ),
    ),
]

CREATE_IDS = [label for label, _, _ in CREATES]


@pytest.mark.parametrize("label,payload,create", CREATES, ids=CREATE_IDS)
def test_create_sends_the_idempotency_key_header(
    label: str, payload: Dict[str, Any], create
):
    handler, seen = capturing(payload)
    create(FakeRestClient(handler), idempotency_key="key-abc")

    assert seen[0].get(IDEMPOTENCY_KEY_HEADER) == "key-abc"


@pytest.mark.parametrize("label,payload,create", CREATES, ids=CREATE_IDS)
def test_create_without_a_key_sends_no_header_at_all(
    label: str, payload: Dict[str, Any], create
):
    """The unkeyed path stores no receipt and must be left exactly as it was."""
    handler, seen = capturing(payload)
    create(FakeRestClient(handler))

    assert IDEMPOTENCY_KEY_HEADER not in seen[0]


@pytest.mark.parametrize("label,payload,create", CREATES, ids=CREATE_IDS)
def test_same_key_twice_returns_the_same_resource(
    label: str, payload: Dict[str, Any], create
):
    handler, seen = capturing(payload, replayed_after_first=True)
    client = FakeRestClient(handler)

    first = create(client, idempotency_key="key-abc")
    second = create(client, idempotency_key="key-abc")

    assert first == second
    assert seen[1].get(IDEMPOTENCY_KEY_HEADER) == "key-abc"


@pytest.mark.parametrize("label,payload,create", CREATES, ids=CREATE_IDS)
def test_replay_is_reported_to_a_caller_who_asked(
    label: str, payload: Dict[str, Any], create
):
    handler, _ = capturing(payload, replayed_after_first=True)
    client = FakeRestClient(handler)
    replays: List[bool] = []

    create(
        client,
        idempotency_key="key-abc",
        on_idempotent_replay=lambda: replays.append(True),
    )
    # A first execution carries no replay header at all, so nothing fires.
    assert replays == []

    create(
        client,
        idempotency_key="key-abc",
        on_idempotent_replay=lambda: replays.append(True),
    )
    assert replays == [True]


def paged_recording_params(pages: List[Dict[str, Any]]):
    """Serves the given pages in order, recording each request's query."""
    seen: List[httpx.QueryParams] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params)
        return httpx.Response(200, json=pages[len(seen) - 1])

    return handler, seen


VK_PAGES = [
    {"data": [{"id": "a"}], "next_cursor": "c1"},
    {"data": [{"id": "b"}], "next_cursor": None},
]
BUDGET_PAGES = [
    {"data": [{"id": "a"}], "spend_available": True, "next_cursor": "c1"},
    {"data": [{"id": "b"}], "spend_available": True, "next_cursor": None},
]

# (label, pages, a callable that runs the whole walk with an external_id)
WALKS = [
    (
        "virtual keys list",
        VK_PAGES,
        lambda client: VirtualKeysFacade(client).list(external_id="tenant-7"),
    ),
    (
        "virtual keys iterate",
        VK_PAGES,
        lambda client: list(VirtualKeysFacade(client).iterate(external_id="tenant-7")),
    ),
    (
        "budgets list",
        BUDGET_PAGES,
        lambda client: GatewayBudgetsFacade(client).list(external_id="tenant-7"),
    ),
    (
        "budgets iterate",
        BUDGET_PAGES,
        lambda client: list(
            GatewayBudgetsFacade(client).iterate(external_id="tenant-7")
        ),
    ),
]


@pytest.mark.parametrize(
    "label,pages,walk", WALKS, ids=[label for label, _, _ in WALKS]
)
def test_external_id_filter_rides_every_page_of_the_walk(
    label: str, pages: List[Dict[str, Any]], walk
):
    handler, seen = paged_recording_params(pages)

    walk(FakeRestClient(handler))

    assert len(seen) == 2
    for params in seen:
        assert params.get("external_id") == "tenant-7"


def test_external_id_is_absent_when_not_asked_for():
    """An always-present filter would narrow every unfiltered listing."""
    handler, seen = paged_recording_params([{"data": [], "next_cursor": None}])

    VirtualKeysFacade(FakeRestClient(handler)).list()

    assert "external_id" not in seen[0]
