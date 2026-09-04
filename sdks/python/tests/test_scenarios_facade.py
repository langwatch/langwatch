"""Unit coverage for the scenarios facade: filing a scenario into a test
suite. Transport is a mounted httpx.MockTransport, so the assertions are on
the bytes that leave the process.

Spec: specs/python-sdk/run-plans-and-test-suites.feature
"""

import json
from typing import Any, Dict, List, Optional, Tuple

import httpx

from langwatch.scenarios import ScenariosFacade

SCENARIO = {"id": "scenario_1", "name": "Refund request"}


class FakeRestClient:
    """The one method the facade uses from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


def recorder(
    payload: Any = SCENARIO, status: int = 200
) -> Tuple[ScenariosFacade, List[Tuple[str, httpx.URL, Optional[Dict[str, Any]]]]]:
    """A facade whose transport records every call and answers `payload`."""
    calls: List[Tuple[str, httpx.URL, Optional[Dict[str, Any]]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url, body))
        return httpx.Response(status, json=payload)

    return ScenariosFacade(FakeRestClient(handler)), calls


# @scenario "Creating a scenario files it into the test suite the caller named"
def test_create_sends_the_test_suite_id_the_caller_named():
    facade, calls = recorder(payload=SCENARIO, status=201)

    facade.create(name="Refund request", test_suite_id="suite_1")

    method, url, body = calls[0]
    assert method == "POST"
    assert url.path == "/api/scenarios"
    assert (body or {})["testSuiteId"] == "suite_1"


# @scenario "Creating a scenario without a test suite sends no testSuiteId"
def test_create_without_a_test_suite_sends_no_test_suite_id():
    facade, calls = recorder(payload=SCENARIO, status=201)

    facade.create(name="Refund request")

    assert "testSuiteId" not in (calls[0][2] or {})


# @scenario "Updating a scenario moves it to the test suite the caller named"
def test_update_sends_the_test_suite_id_the_caller_named():
    facade, calls = recorder()

    facade.update("scenario_1", test_suite_id="suite_2")

    method, url, body = calls[0]
    assert method == "PUT"
    assert url.path == "/api/scenarios/scenario_1"
    assert (body or {})["testSuiteId"] == "suite_2"


# @scenario "An update that names no test suite leaves the scenario where it is"
def test_update_without_a_test_suite_sends_no_test_suite_id():
    facade, calls = recorder()

    facade.update("scenario_1", params={"name": "Refund request v2"})

    body = calls[0][2] or {}
    assert body == {"name": "Refund request v2"}


# @scenario "An update with a null test suite unfiles the scenario"
def test_update_with_a_none_test_suite_id_sends_null():
    facade, calls = recorder()

    facade.update("scenario_1", test_suite_id=None)

    assert (calls[0][2] or {}) == {"testSuiteId": None}
