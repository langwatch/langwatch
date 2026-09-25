"""Unit coverage for the dashboards facade's list, the one dashboards route
whose 200 body is wrapped in a ``{"data": ...}`` envelope. Transport is a
mounted httpx.MockTransport; no network.
"""

from typing import Any, Dict

import httpx

from langwatch.dashboards import DashboardsFacade


class FakeRestClient:
    """The one method the facade uses from the generated client."""

    def __init__(self, payload: Dict[str, Any]) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json=payload)
            ),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


DASHBOARD = {"id": "dashboard_1", "name": "Latency", "graphCount": 3}


class TestGivenTheListRouteWrapsDashboardsInADataEnvelope:
    """The detail, create, rename and delete routes answer bare bodies; only
    the list is wrapped, which is why it is the only one to unwrap."""

    def test_list_returns_the_dashboard_rows(self):
        facade = DashboardsFacade(FakeRestClient({"data": [DASHBOARD]}))

        assert facade.list() == [DASHBOARD]

    def test_list_returns_an_empty_list_when_the_project_has_none(self):
        facade = DashboardsFacade(FakeRestClient({"data": []}))

        assert facade.list() == []

    def test_get_returns_the_bare_dashboard_it_is_served(self):
        facade = DashboardsFacade(FakeRestClient(DASHBOARD))

        assert facade.get("dashboard_1") == DASHBOARD
