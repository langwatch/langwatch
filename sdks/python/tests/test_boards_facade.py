"""Unit coverage for the boards facade and the dashboards deprecation warning:
every method hits its /api/v1/boards route with the right verb and body, and
the dashboards facade warns once when the server marks it deprecated.

Spec: modules/dashboard/specs/dashboards-v2.feature
  AC199s Split: the CLI and MCP manage boards and warn on the deprecated route
"""

import json
import warnings
from typing import Any

import httpx
import pytest

import langwatch.dashboards as dashboards_module
from langwatch.boards import BoardsFacade
from langwatch.dashboards import DashboardsFacade


class FakeRestClient:
    """The one method the facades use from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


def recorder(responses: dict[tuple[str, str], Any], headers: dict[str, str] | None = None):
    calls: list[tuple[str, str, Any | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url.path, body))
        assert key in responses, f"unexpected call {key}"
        payload = responses[key]
        if payload is None:
            return httpx.Response(204, headers=headers or {})
        return httpx.Response(200, json=payload, headers=headers or {})

    return handler, calls


def test_board_routes_and_bodies():
    board = {"id": "b_1", "name": "Usage"}
    widget = {"id": "w_1", "name": "Traces", "dashboardId": "b_1"}
    handler, calls = recorder(
        {
            ("GET", "/api/v1/boards"): {"data": [board]},
            ("POST", "/api/v1/boards"): board,
            ("GET", "/api/v1/boards/b_1"): board,
            ("PATCH", "/api/v1/boards/b_1"): board,
            ("DELETE", "/api/v1/boards/b_1"): {"id": "b_1", "name": "Usage"},
            ("GET", "/api/v1/boards/b_1/widgets"): {"data": [widget]},
            ("POST", "/api/v1/boards/b_1/widgets"): widget,
            ("GET", "/api/v1/boards/b_1/widgets/w_1"): widget,
            ("PATCH", "/api/v1/boards/b_1/widgets/w_1"): widget,
            ("DELETE", "/api/v1/boards/b_1/widgets/w_1"): None,
        }
    )
    boards = BoardsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    boards.list()
    boards.create(name="Usage")
    boards.get("b_1")
    boards.update("b_1", description=None)
    boards.delete("b_1")
    boards.list_widgets("b_1")
    boards.create_widget("b_1", name="Traces", code="export default () => null;", queries=[])
    boards.get_widget("b_1", "w_1")
    boards.update_widget("b_1", "w_1", name="P95")
    boards.delete_widget("b_1", "w_1")

    assert calls == [
        ("GET", "/api/v1/boards", None),
        ("POST", "/api/v1/boards", {"name": "Usage"}),
        ("GET", "/api/v1/boards/b_1", None),
        ("PATCH", "/api/v1/boards/b_1", {"description": None}),
        ("DELETE", "/api/v1/boards/b_1", None),
        ("GET", "/api/v1/boards/b_1/widgets", None),
        (
            "POST",
            "/api/v1/boards/b_1/widgets",
            {"name": "Traces", "code": "export default () => null;", "queries": []},
        ),
        ("GET", "/api/v1/boards/b_1/widgets/w_1", None),
        ("PATCH", "/api/v1/boards/b_1/widgets/w_1", {"name": "P95"}),
        ("DELETE", "/api/v1/boards/b_1/widgets/w_1", None),
    ]


def test_update_naming_nothing_is_refused_before_any_call():
    handler, calls = recorder({})
    boards = BoardsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    with pytest.raises(ValueError):
        boards.update("b_1")
    assert calls == []


def test_flag_off_404_is_not_found():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "dashboards_not_released", "message": "Not found"})

    boards = BoardsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="Not found"):
        boards.list()


def test_dashboards_warns_once_when_deprecated(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(dashboards_module, "_DEPRECATION_WARNED", False)
    handler, _ = recorder(
        {("GET", "/api/v1/dashboards"): {"data": []}},
        headers={"Deprecation": "true", "Link": '</api/v1/boards>; rel="successor-version"'},
    )
    dashboards = DashboardsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert dashboards.list() == {"data": []}
        dashboards.list()

    messages = [str(w.message) for w in caught if issubclass(w.category, FutureWarning)]
    assert len(messages) == 1
    assert "/api/v1/boards" in messages[0]


def test_dashboards_stays_quiet_without_the_header(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(dashboards_module, "_DEPRECATION_WARNED", False)
    handler, _ = recorder({("GET", "/api/v1/dashboards"): {"data": []}})
    dashboards = DashboardsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        dashboards.list()

    assert [w for w in caught if issubclass(w.category, FutureWarning)] == []
