"""Unit coverage for the boards facade and the Analytics Reports dashboards facade:
every boards method hits its /api/v1/dashboards route with the right verb and
body, and the dashboards facade uses /api/v1/analytics/reports.

Spec: modules/dashboard/specs/dashboards-v2.feature
  AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards
"""

import json
from typing import Any

import httpx
import pytest

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


def recorder(responses: dict[tuple[str, str], Any]):
    calls: list[tuple[str, str, Any | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url.path, body))
        assert key in responses, f"unexpected call {key}"
        payload = responses[key]
        if payload is None:
            return httpx.Response(204)
        return httpx.Response(200, json=payload)

    return handler, calls


def test_board_routes_and_bodies():
    board = {"id": "b_1", "name": "Usage"}
    widget = {"id": "w_1", "name": "Traces", "dashboardId": "b_1"}
    handler, calls = recorder(
        {
            ("GET", "/api/v1/dashboards"): {"data": [board]},
            ("POST", "/api/v1/dashboards"): board,
            ("GET", "/api/v1/dashboards/b_1"): board,
            ("PATCH", "/api/v1/dashboards/b_1"): board,
            ("DELETE", "/api/v1/dashboards/b_1"): {"id": "b_1", "name": "Usage"},
            ("GET", "/api/v1/dashboards/b_1/widgets"): {"data": [widget]},
            ("POST", "/api/v1/dashboards/b_1/widgets"): widget,
            ("GET", "/api/v1/dashboards/b_1/widgets/w_1"): widget,
            ("PATCH", "/api/v1/dashboards/b_1/widgets/w_1"): widget,
            ("DELETE", "/api/v1/dashboards/b_1/widgets/w_1"): None,
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
        ("GET", "/api/v1/dashboards", None),
        ("POST", "/api/v1/dashboards", {"name": "Usage"}),
        ("GET", "/api/v1/dashboards/b_1", None),
        ("PATCH", "/api/v1/dashboards/b_1", {"description": None}),
        ("DELETE", "/api/v1/dashboards/b_1", None),
        ("GET", "/api/v1/dashboards/b_1/widgets", None),
        (
            "POST",
            "/api/v1/dashboards/b_1/widgets",
            {"name": "Traces", "code": "export default () => null;", "queries": []},
        ),
        ("GET", "/api/v1/dashboards/b_1/widgets/w_1", None),
        ("PATCH", "/api/v1/dashboards/b_1/widgets/w_1", {"name": "P95"}),
        ("DELETE", "/api/v1/dashboards/b_1/widgets/w_1", None),
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


def test_analytics_reports_dashboards_use_the_reports_routes():
    handler, calls = recorder(
        {
            ("GET", "/api/v1/analytics/reports"): {"data": []},
            ("POST", "/api/v1/analytics/reports"): {"id": "d_1"},
            ("GET", "/api/v1/analytics/reports/d_1"): {"id": "d_1"},
            ("PATCH", "/api/v1/analytics/reports/d_1"): {"id": "d_1"},
            ("DELETE", "/api/v1/analytics/reports/d_1"): {"id": "d_1"},
        }
    )
    dashboards = DashboardsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    dashboards.list()
    dashboards.create(name="Usage")
    dashboards.get("d_1")
    dashboards.rename("d_1", name="Cost")
    dashboards.delete("d_1")

    assert calls == [
        ("GET", "/api/v1/analytics/reports", None),
        ("POST", "/api/v1/analytics/reports", {"name": "Usage"}),
        ("GET", "/api/v1/analytics/reports/d_1", None),
        ("PATCH", "/api/v1/analytics/reports/d_1", {"name": "Cost"}),
        ("DELETE", "/api/v1/analytics/reports/d_1", None),
    ]
