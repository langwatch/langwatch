"""Unit coverage for the webhooks and spend-events facades: every method
hits its route with the right verb and shape, and unwraps the envelope
the REST apps actually serve. Transport is a mounted httpx.MockTransport;
no network, no generated-client coupling beyond get_httpx_client().

Virtual keys and gateway budgets live in tests/test_gateway_facades.py.

Spec: specs/webhooks/webhook-endpoints.feature
      specs/ai-gateway/billing-spend-events.feature
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

from langwatch.api_errors import LangWatchApiError, LangWatchApiPlanLimitError

from langwatch.spend_events import _FILTER_PARAMS, SpendEventsFacade
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


def paged(handler_pages: List[Dict[str, Any]]):
    """A handler that serves the given pages in order, recording cursors."""
    seen_cursors: List[Optional[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_cursors.append(request.url.params.get("cursor"))
        return httpx.Response(200, json=handler_pages[len(seen_cursors) - 1])

    return handler, seen_cursors


def test_webhooks_facade_routes_and_envelopes():
    handler, calls = recorder(
        {
            ("GET", "/api/webhooks/v1/endpoints"): {"data": [{"id": "we_1"}]},
            ("POST", "/api/webhooks/v1/endpoints"): {
                "data": {"id": "we_1", "secret": "whsec_x"}
            },
            ("GET", "/api/webhooks/v1/endpoints/we_1"): {"data": {"id": "we_1"}},
            ("PATCH", "/api/webhooks/v1/endpoints/we_1"): {
                "data": {"id": "we_1", "max_batch_size": 50}
            },
            ("DELETE", "/api/webhooks/v1/endpoints/we_1"): {
                "data": {"archived": True}
            },
            ("POST", "/api/webhooks/v1/endpoints/we_1/roll-secret"): {
                "data": {"id": "we_1", "secret": "whsec_y"}
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
            ("GET", "/api/webhooks/v1/events/evt_1"): {
                "data": {"id": "evt_1", "type": "gateway.request.completed"}
            },
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

    assert facade.get("we_1")["id"] == "we_1"
    assert facade.update("we_1", max_batch_size=50)["max_batch_size"] == 50
    assert facade.roll_secret("we_1")["secret"] == "whsec_y"
    assert facade.health("we_1")["dlq_depth"] == 0
    assert facade.deliveries_page("we_1", limit=10)["data"] == []
    assert facade.test("we_1")["delivered"] is True
    assert facade.event_types()[0]["type"] == "gateway.request.completed"
    assert (
        facade.events_page(
            type="gateway.request.completed", from_ms=1, to_ms=2
        )["data"]
        == []
    )
    assert facade.get_event("evt_1")["id"] == "evt_1"
    # The range is required by the route, so a facade that dropped either bound
    # would 422 against a real server while this fake happily answered.
    events_call = next(c for c in calls if "/v1/events?" in c[1])
    assert "from=1" in events_call[1]
    assert "to=2" in events_call[1]

    # Archiving is a soft delete: nothing to hand back, only the route to hit.
    assert facade.archive("we_1") is None
    assert ("DELETE", "http://langwatch.test/api/webhooks/v1/endpoints/we_1", None) in calls


def test_webhooks_update_sends_only_the_keys_passed():
    """An omitted field must be left alone, not cleared.

    The params are explicit keyword args, so a caller changing one control
    cannot accidentally send nulls for the rest.
    """
    handler, calls = recorder(
        {("PATCH", "/api/webhooks/v1/endpoints/we_1"): {"data": {"id": "we_1"}}}
    )
    facade = WebhooksFacade(FakeRestClient(handler))

    facade.update("we_1", status="disabled")
    assert calls[-1][2] == {"status": "disabled"}

    facade.update("we_1", url="https://receiver.example/v2", max_in_flight=8)
    assert calls[-1][2] == {
        "url": "https://receiver.example/v2",
        "max_in_flight": 8,
    }


def test_iter_deliveries_walks_every_page():
    handler, seen_cursors = paged(
        [
            {"data": [{"id": "d_1"}, {"id": "d_2"}], "next_cursor": "c1"},
            {"data": [{"id": "d_3"}], "next_cursor": None},
        ]
    )
    facade = WebhooksFacade(FakeRestClient(handler))

    rows = list(facade.iter_deliveries("we_1"))
    assert [r["id"] for r in rows] == ["d_1", "d_2", "d_3"]
    assert seen_cursors == [None, "c1"]


def test_iter_events_walks_every_page():
    handler, seen_cursors = paged(
        [
            {"data": [{"id": "evt_1"}], "next_cursor": "c1"},
            {"data": [{"id": "evt_2"}], "next_cursor": None},
        ]
    )
    facade = WebhooksFacade(FakeRestClient(handler))

    rows = list(
        facade.iter_events(type="gateway.request.completed", from_ms=1, to_ms=2)
    )
    assert [r["id"] for r in rows] == ["evt_1", "evt_2"]
    assert seen_cursors == [None, "c1"]


def test_spend_facade_routes_and_envelopes():
    handler, calls = recorder(
        {
            ("GET", "/api/gateway/v1/spend-events"): {"data": [], "next_cursor": None},
            ("GET", "/api/gateway/v1/spend-summaries"): {
                "data": [{"key": "vk_1", "event_count": 2, "settled_count": 0}],
                "next_cursor": None,
            },
            ("POST", "/api/gateway/v1/spend-events/replay"): {
                "data": {"replayed": 2, "endpoint_id": "we_1"}
            },
            ("GET", "/api/gateway/v1/end-users/user/9/spend"): {
                "data": {"end_user_id": "user/9", "caps": []}
            },
        }
    )
    facade = SpendEventsFacade(FakeRestClient(handler))

    assert facade.list_page(from_ms=1, to_ms=2, end_user_id="user-9")["data"] == []
    listed = next(c for c in calls if "/spend-events?" in c[1])
    assert "end_user_id=user-9" in listed[1]

    rows = list(facade.iter_summaries(group_by="virtual_key", from_ms=1, to_ms=2))
    assert rows[0]["settled_count"] == 0

    replayed = facade.replay(from_ms=1, to_ms=2, endpoint_id="we_1")
    assert replayed["replayed"] == 2

    # Path-encodes external ids: end users are caller-supplied strings.
    spend = facade.end_user_spend("user/9")
    assert spend["caps"] == []
    wire = next(c for c in calls if "/end-users/" in c[1])
    assert "user%2F9" in wire[1]


def test_iter_events_sends_the_required_range_on_every_page():
    """The range is required by the route, so a walk that carried it only on
    the first page would 422 partway through."""
    seen: List[Dict[str, Optional[str]]] = []
    pages = [
        {"data": [{"id": "evt_1"}], "next_cursor": "c1"},
        {"data": [{"id": "evt_2"}], "next_cursor": None},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(
            {
                "from": request.url.params.get("from"),
                "to": request.url.params.get("to"),
                "cursor": request.url.params.get("cursor"),
            }
        )
        return httpx.Response(200, json=pages[len(seen) - 1])

    facade = WebhooksFacade(FakeRestClient(handler))
    rows = list(facade.iter_events(from_ms=1, to_ms=2))

    assert [r["id"] for r in rows] == ["evt_1", "evt_2"]
    assert [p["from"] for p in seen] == ["1", "1"]
    assert [p["to"] for p in seen] == ["2", "2"]
    assert [p["cursor"] for p in seen] == [None, "c1"]


def test_spend_events_page_sends_the_project_and_model_filters():
    """The server filters on both, and a reconciler scoped to one project
    silently reads the whole organization without them."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("project_id") == "proj_9"
        assert request.url.params.get("model") == "gpt-4o-mini"
        assert request.url.params.get("status") == "settled"
        return httpx.Response(200, json={"data": [], "next_cursor": None})

    facade = SpendEventsFacade(FakeRestClient(handler))
    page = facade.list_page(
        from_ms=1,
        to_ms=2,
        project_id="proj_9",
        model="gpt-4o-mini",
        status="settled",
    )
    assert page["next_cursor"] is None


def test_both_spend_reads_take_the_same_filter_vocabulary():
    """A reconciliation checksums the rollups and diffs the events when a
    checksum disagrees, so it has to be able to ask both the same question.
    Repeating a parameter widens it; naming two narrows."""
    seen: List[Dict[str, List[str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(
            {
                name: request.url.params.get_list(name)
                for name in (
                    "team_id",
                    "external_id",
                    "principal_user_id",
                    "provider_key",
                    "request_type",
                    "label",
                    "model",
                )
            }
        )
        return httpx.Response(200, json={"data": [], "next_cursor": None})

    facade = SpendEventsFacade(FakeRestClient(handler))
    filters: Dict[str, Any] = {
        "team_id": "team_1",
        "external_id": ["cust_a", "cust_b"],
        "principal_user_id": "user_1",
        "provider_key": ["openai", "anthropic"],
        "request_type": "chat",
        "label": ["prod"],
        "model": ["gpt-5-mini", "claude-sonnet-5"],
    }

    facade.list_page(from_ms=1, to_ms=2, **filters)
    facade.summaries_page(group_by="project", from_ms=1, to_ms=2, **filters)

    assert len(seen) == 2
    assert seen[0] == seen[1], "the two reads must narrow identically"
    assert seen[0]["external_id"] == ["cust_a", "cust_b"]
    assert seen[0]["model"] == ["gpt-5-mini", "claude-sonnet-5"]
    assert seen[0]["team_id"] == ["team_1"]


def test_metadata_filters_ride_as_key_colon_value():
    """Several values for one key widen that key, several keys narrow, so a
    dict of lists is the shape a caller already thinks in."""
    seen: List[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.extend(request.url.params.get_list("metadata"))
        return httpx.Response(200, json={"data": [], "next_cursor": None})

    facade = SpendEventsFacade(FakeRestClient(handler))
    facade.list_page(
        from_ms=1,
        to_ms=2,
        metadata={"tier": ["gold", "silver"], "region": "eu"},
    )

    assert sorted(seen) == ["region:eu", "tier:gold", "tier:silver"]


def test_a_metadata_key_carrying_a_colon_is_refused_rather_than_sent():
    """The API splits a pair on its FIRST colon, so `{"a:b": "c"}` would ride
    as `a:b:c` and be read as key `a`, value `b:c`: spend for a filter the
    caller never wrote, with no error to say so. The TypeScript SDK and the
    CLI both refuse it, so this one does too."""

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("the request should never have been sent")

    facade = SpendEventsFacade(FakeRestClient(handler))

    with pytest.raises(ValueError, match="colon"):
        facade.list_page(from_ms=1, to_ms=2, metadata={"a:b": "c"})

    # An empty value is refused for the same class of reason: a missing map
    # key reads back as the type default, so `tier:` would match every
    # request that carries no `tier` at all.
    with pytest.raises(ValueError, match="empty"):
        facade.list_page(from_ms=1, to_ms=2, metadata={"tier": ""})


def test_summaries_page_joins_the_grouping_and_carries_the_bucket():
    """Two dimensions go on the wire comma-separated, and a bucket needs the
    zone its boundaries fall on or a day means something different per
    caller."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("group_by") == "model,provider"
        assert request.url.params.get("bucket") == "day"
        assert request.url.params.get("timezone") == "Europe/Amsterdam"
        assert request.url.params.get("allow_unstable") == "true"
        return httpx.Response(200, json={"data": [], "next_cursor": None})

    facade = SpendEventsFacade(FakeRestClient(handler))
    facade.summaries_page(
        group_by=["model", "provider"],
        from_ms=1,
        to_ms=2,
        bucket="day",
        timezone="Europe/Amsterdam",
        allow_unstable=True,
    )


def test_iter_summaries_keeps_the_grouping_and_filters_on_every_page():
    """A walk that dropped them on page two would fold rows from a different
    question into the same checksum."""
    pages = [
        {"data": [{"key": "gpt-5-mini"}], "next_cursor": "c1"},
        {"data": [{"key": "claude-sonnet-5"}], "next_cursor": None},
    ]
    seen: List[httpx.QueryParams] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params)
        return httpx.Response(200, json=pages[len(seen) - 1])

    facade = SpendEventsFacade(FakeRestClient(handler))
    rows = list(
        facade.iter_summaries(
            group_by="model",
            from_ms=1,
            to_ms=2,
            bucket="hour",
            provider_key=["openai"],
            metadata={"tier": "gold"},
            allow_unstable=True,
        )
    )

    assert [r["key"] for r in rows] == ["gpt-5-mini", "claude-sonnet-5"]
    assert len(seen) == 2
    for params in seen:
        assert params.get("group_by") == "model"
        assert params.get("bucket") == "hour"
        assert params.get("provider_key") == "openai"
        assert params.get("metadata") == "tier:gold"
        assert params.get("allow_unstable") == "true"
    assert seen[1].get("cursor") == "c1"


def test_the_facade_offers_every_filter_the_published_contract_publishes():
    """The SDK lagged the REST surface by seven filters once, and nothing
    failed: a reconciler simply could not narrow a walk to what its checksum
    had covered. Read against the published document rather than the server
    source, because the document is what a caller reads."""
    spec_path = (
        Path(__file__).parents[3] / "platform/app/src/app/api/openapiLangWatch.json"
    )
    assert spec_path.exists(), (
        f"{spec_path} is missing, so this check would pass without checking "
        "anything. Point it at the published spec rather than skipping."
    )
    spec = json.loads(spec_path.read_text())

    offered = set(_FILTER_PARAMS) | {"metadata", "status"}
    # Paging and windowing are not filters, and the rollup controls shape a
    # rollup rather than narrowing one.
    not_a_filter = {"from", "to", "cursor", "limit"}
    rollup_only = {"group_by", "bucket", "timezone", "allow_unstable"}

    # Both reads, because the facade sends the same filter parameters to each:
    # a filter published on the rollups alone would be just as unreachable.
    for path in (
        "/api/gateway/v1/spend-events",
        "/api/gateway/v1/spend-summaries",
    ):
        operation = spec["paths"][path]["get"]
        published = {p["name"] for p in operation["parameters"] if p["in"] == "query"}
        published -= not_a_filter | rollup_only
        assert offered == published, path


def test_a_movable_grouping_surfaces_the_refusal_code():
    """Refused rather than served approximately: a page walk over a group
    whose rows can still move counts some requests twice and misses others,
    and a checksum built on that disagrees with the books silently."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={
                "error": {
                    "code": "gateway_spend_group_by_unstable",
                    "meta": {"settles_at": "2026-08-07T05:30:00.000Z"},
                }
            },
        )

    facade = SpendEventsFacade(FakeRestClient(handler))
    with pytest.raises(LangWatchApiError) as raised:
        facade.summaries_page(group_by="model", from_ms=1, to_ms=2)

    assert raised.value.code == "gateway_spend_group_by_unstable"
    assert raised.value.body["error"]["meta"]["settles_at"].startswith("2026-")


def test_spend_events_iterate_walks_every_page():
    handler, seen_cursors = paged(
        [
            {"data": [{"id": "se_1"}, {"id": "se_2"}], "next_cursor": "c1"},
            {"data": [{"id": "se_3"}], "next_cursor": None},
        ]
    )
    facade = SpendEventsFacade(FakeRestClient(handler))

    rows = list(facade.iterate(from_ms=1, to_ms=2, project_id="proj_9"))
    assert [r["id"] for r in rows] == ["se_1", "se_2", "se_3"]
    assert seen_cursors == [None, "c1"]


def test_errors_surface_operation_and_detail():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": "plan_required"})

    facade = SpendEventsFacade(FakeRestClient(handler))
    with pytest.raises(LangWatchApiPlanLimitError, match="list spend events"):
        facade.list_page(from_ms=1, to_ms=2)


def test_refusals_carry_the_platform_code_rather_than_only_prose():
    """A consumer branches on the code: the message is written for a human
    reading a log and will change, the code is the contract."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={
                "error": {
                    "code": "idempotency_error",
                    "meta": {"reason": "body_mismatch"},
                }
            },
        )

    facade = SpendEventsFacade(FakeRestClient(handler))
    with pytest.raises(LangWatchApiError) as raised:
        facade.list_page(from_ms=1, to_ms=2)

    error = raised.value
    assert error.code == "idempotency_error"
    assert error.status == 409
    assert error.operation == "list spend events"
    # The parsed payload survives for the fields the class does not promote.
    assert error.body["error"]["meta"]["reason"] == "body_mismatch"


def test_local_misuse_is_not_an_api_error():
    """A malformed cursor chain never crossed the wire, so it carries no code
    and must not look like a refusal from the platform."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [], "next_cursor": "stuck"})

    facade = SpendEventsFacade(FakeRestClient(handler))
    with pytest.raises(RuntimeError) as raised:
        list(facade.iterate(from_ms=1, to_ms=2))
    assert not isinstance(raised.value, LangWatchApiError)


def test_summaries_walk_follows_the_cursor_to_the_end():
    """A reconciler must see every key in the window, not the first page.

    The facade used to drop next_cursor on the floor, so a window holding
    more keys than the page limit silently reconciled against a prefix of
    itself and the totals looked clean.
    """
    handler, seen_cursors = paged(
        [
            {"data": [{"key": "vk_1"}, {"key": "vk_2"}], "next_cursor": "c1"},
            {"data": [{"key": "vk_3"}], "next_cursor": None},
        ]
    )

    facade = SpendEventsFacade(FakeRestClient(handler))
    rows = list(facade.iter_summaries(group_by="virtual_key", from_ms=1, to_ms=2))

    assert [r["key"] for r in rows] == ["vk_1", "vk_2", "vk_3"]
    # First call carries no cursor; the second carries the one page 1 issued.
    assert seen_cursors == [None, "c1"]


def test_summaries_page_exposes_the_cursor_and_the_key_filter():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("virtual_key_id") == "vk_7"
        assert request.url.params.get("cursor") == "c0"
        return httpx.Response(200, json={"data": [], "next_cursor": None})

    facade = SpendEventsFacade(FakeRestClient(handler))
    page = facade.summaries_page(
        group_by="virtual_key",
        from_ms=1,
        to_ms=2,
        cursor="c0",
        virtual_key_id="vk_7",
    )
    assert page["next_cursor"] is None
