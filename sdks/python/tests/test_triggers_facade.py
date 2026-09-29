"""Unit coverage for the triggers facade: every method hits its route with
the right verb, body and query. Transport is a mounted httpx.MockTransport.

Spec: specs/automations/public-api.feature
"""

import json
from typing import Any

import httpx
import pytest

from langwatch.triggers import TriggersFacade


class FakeRestClient:
    """The one method the facade uses from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


def recorder(responses: dict[tuple[str, str], Any]):
    calls: list[tuple[str, str, Any | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, str(request.url), body))
        payload = responses.get(key)
        assert payload is not None, f"unexpected call {key}"
        return httpx.Response(200, json=payload)

    return handler, calls


def facade(handler) -> TriggersFacade:
    return TriggersFacade(FakeRestClient(handler))  # type: ignore[arg-type]


def test_crud_routes_and_bodies():
    trigger = {"id": "t_1", "name": "Errors", "active": True}
    handler, calls = recorder(
        {
            ("GET", "/api/triggers"): [trigger],
            ("POST", "/api/triggers"): trigger,
            ("GET", "/api/triggers/t_1"): trigger,
            ("PATCH", "/api/triggers/t_1"): trigger,
            ("DELETE", "/api/triggers/t_1"): {"id": "t_1", "deleted": True},
        }
    )
    triggers = facade(handler)
    create_body = {
        "name": "Errors",
        "action": "SEND_SLACK_MESSAGE",
        "actionParams": {"slackIntegrationId": "si_1", "slackChannelId": "C1"},
        "customGraphId": "g_1",
        "graphAlert": {
            "threshold": 5,
            "operator": "gt",
            "timePeriod": 60,
            "seriesName": "errors",
        },
        "alertType": "WARNING",
    }
    update_body = {"actionParams": {"slackBotToken": "[redacted]"}}

    assert triggers.list() == [trigger]
    assert triggers.create(params=create_body) == trigger
    assert triggers.get("t_1") == trigger
    assert triggers.update("t_1", params=update_body) == trigger
    assert triggers.delete("t_1") == {"id": "t_1", "deleted": True}

    assert [(m, b) for m, _, b in calls] == [
        ("GET", None),
        ("POST", create_body),
        ("GET", None),
        ("PATCH", update_body),
        ("DELETE", None),
    ]


def test_fires_passes_cursor_and_limit_only_when_given():
    page = {"fires": [{"id": "f_1"}], "nextCursor": "c_2"}
    handler, calls = recorder({("GET", "/api/triggers/t_1/fires"): page})
    triggers = facade(handler)

    assert triggers.fires("t_1") == page
    assert triggers.fires("t_1", cursor="c_2", limit=10) == page

    assert calls[0][1] == "http://langwatch.test/api/triggers/t_1/fires"
    params = httpx.URL(calls[1][1]).params
    assert params.get("cursor") == "c_2"
    assert params.get("limit") == "10"


def test_enable_disable_and_test_fire():
    trigger = {"id": "t_1", "active": True}
    result = {
        "channel": "slack",
        "recipientCount": 1,
        "usedDefault": True,
        "missingVariables": [],
        "errors": [],
    }
    handler, calls = recorder(
        {
            ("POST", "/api/triggers/t_1/enable"): trigger,
            ("POST", "/api/triggers/t_1/disable"): {**trigger, "active": False},
            ("POST", "/api/triggers/t_1/test-fire"): result,
        }
    )
    triggers = facade(handler)

    assert triggers.enable("t_1") == trigger
    assert triggers.disable("t_1")["active"] is False
    assert triggers.test_fire("t_1") == result
    assert [m for m, _, _ in calls] == ["POST", "POST", "POST"]


def test_trigger_id_is_quoted_into_the_path():
    seen: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.raw_path)
        return httpx.Response(200, json={})

    facade(handler).enable("a/b")
    assert seen == [b"/api/triggers/a%2Fb/enable"]


@pytest.mark.parametrize(
    "status, error",
    [(404, ValueError), (400, ValueError), (401, RuntimeError), (500, RuntimeError)],
)
def test_errors_map_to_exceptions(status: int, error: type):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"message": "nope"})

    with pytest.raises(error):
        facade(handler).test_fire("t_1")
