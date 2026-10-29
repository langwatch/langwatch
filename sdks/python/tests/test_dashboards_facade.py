"""Unit coverage for the Dashboards facade and the Analytics Reports facade:
every dashboards method hits its /api/v1/dashboards route with the right verb and
body, and the analytics reports facade uses /api/v1/analytics/reports.

Spec: modules/dashboard/specs/dashboards-v2.feature
  AC199s Split: the CLI and MCP manage Dashboards at /api/v1/dashboards
  AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports
"""

import importlib
import json
from typing import Any

import httpx
import pytest

import langwatch
from langwatch.analytics_reports import AnalyticsReportsFacade
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




# @scenario "AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports"
def test_dashboard_routes_and_bodies():
    dashboard = {"id": "d_1", "name": "Usage"}
    widget = {"id": "w_1", "name": "Traces", "dashboardId": "d_1"}
    handler, calls = recorder(
        {
            ("GET", "/api/v1/dashboards"): {"data": [dashboard]},
            ("POST", "/api/v1/dashboards"): dashboard,
            ("GET", "/api/v1/dashboards/d_1"): dashboard,
            ("PATCH", "/api/v1/dashboards/d_1"): dashboard,
            ("DELETE", "/api/v1/dashboards/d_1"): {"id": "d_1", "name": "Usage"},
            ("GET", "/api/v1/dashboards/d_1/widgets"): {"data": [widget]},
            ("POST", "/api/v1/dashboards/d_1/widgets"): widget,
            ("GET", "/api/v1/dashboards/d_1/widgets/w_1"): widget,
            ("PATCH", "/api/v1/dashboards/d_1/widgets/w_1"): widget,
            ("DELETE", "/api/v1/dashboards/d_1/widgets/w_1"): None,
        }
    )
    dashboards = DashboardsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    dashboards.list()
    dashboards.create(name="Usage")
    dashboards.get("d_1")
    dashboards.update("d_1", description=None)
    dashboards.delete("d_1")
    dashboards.list_widgets("d_1")
    dashboards.create_widget("d_1", name="Traces", code="export default () => null;", queries=[])
    dashboards.get_widget("d_1", "w_1")
    dashboards.update_widget("d_1", "w_1", name="P95")
    dashboards.delete_widget("d_1", "w_1")

    assert calls == [
        ("GET", "/api/v1/dashboards", None),
        ("POST", "/api/v1/dashboards", {"name": "Usage"}),
        ("GET", "/api/v1/dashboards/d_1", None),
        ("PATCH", "/api/v1/dashboards/d_1", {"description": None}),
        ("DELETE", "/api/v1/dashboards/d_1", None),
        ("GET", "/api/v1/dashboards/d_1/widgets", None),
        (
            "POST",
            "/api/v1/dashboards/d_1/widgets",
            {"name": "Traces", "code": "export default () => null;", "queries": []},
        ),
        ("GET", "/api/v1/dashboards/d_1/widgets/w_1", None),
        ("PATCH", "/api/v1/dashboards/d_1/widgets/w_1", {"name": "P95"}),
        ("DELETE", "/api/v1/dashboards/d_1/widgets/w_1", None),
    ]


# @scenario "AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports"
def test_update_naming_nothing_is_refused_before_any_call():
    handler, calls = recorder({})
    dashboards = DashboardsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    with pytest.raises(ValueError):
        dashboards.update("d_1")
    assert calls == []


# @scenario "AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports"
def test_flag_off_404_is_dashboard_not_found():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "dashboards_not_released", "message": "Not found"})

    dashboards = DashboardsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="Dashboard not found"):
        dashboards.list()


# @scenario "AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports"
def test_analytics_reports_use_the_reports_routes():
    handler, calls = recorder(
        {
            ("GET", "/api/v1/analytics/reports"): {"data": []},
            ("POST", "/api/v1/analytics/reports"): {"id": "r_1"},
            ("GET", "/api/v1/analytics/reports/r_1"): {"id": "r_1"},
            ("PATCH", "/api/v1/analytics/reports/r_1"): {"id": "r_1"},
            ("DELETE", "/api/v1/analytics/reports/r_1"): {"id": "r_1"},
        }
    )
    reports = AnalyticsReportsFacade(FakeRestClient(handler))  # type: ignore[arg-type]

    reports.list()
    reports.create(name="Usage")
    reports.get("r_1")
    reports.rename("r_1", name="Cost")
    reports.delete("r_1")

    assert calls == [
        ("GET", "/api/v1/analytics/reports", None),
        ("POST", "/api/v1/analytics/reports", {"name": "Usage"}),
        ("GET", "/api/v1/analytics/reports/r_1", None),
        ("PATCH", "/api/v1/analytics/reports/r_1", {"name": "Cost"}),
        ("DELETE", "/api/v1/analytics/reports/r_1", None),
    ]


# @scenario "AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports"
def test_names_dashboards_and_analytics_reports_resolve_to_their_facades():
    """langwatch.dashboards is the Dashboards facade, langwatch.analytics_reports the Reports one."""
    for stale in ("analytics_reports", "dashboards"):
        vars(langwatch).pop(stale, None)
    langwatch.setup(api_key="test-key", endpoint_url="http://langwatch.test")

    assert isinstance(langwatch.dashboards, DashboardsFacade)
    assert isinstance(langwatch.analytics_reports, AnalyticsReportsFacade)


# @scenario "AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports"
def test_there_is_no_boards_alias():
    """The old name is gone: neither the attribute nor the module answers."""
    vars(langwatch).pop("boards", None)

    with pytest.raises(AttributeError):
        langwatch.boards  # noqa: B018
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("langwatch.boards")
