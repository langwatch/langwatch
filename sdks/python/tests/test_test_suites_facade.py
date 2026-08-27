"""Unit coverage for the test suites facade: every method hits its route with
the right verb and body, running one sends the targets and lets the platform
name the plan, and the legacy error envelope still reaches the caller as a
readable detail. The deprecated `langwatch.suites` facade is covered here too,
because its replacement is what this file tests. Transport is a mounted
httpx.MockTransport, so the assertions are on the bytes that leave the process.

Spec: specs/python-sdk/run-plans-and-test-suites.feature
"""

import json
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

from langwatch.api_errors import LangWatchApiNotFoundError
from langwatch.suites import SuitesFacade
from langwatch.test_suites import TestSuitesFacade

TARGET = {"type": "prompt", "referenceId": "prompt_1"}

TEST_SUITE = {
    "id": "suite_1",
    "name": "Refunds",
    "slug": "refunds",
    "scenarios": [{"id": "scenario_1", "name": "Refund over the limit"}],
}

RUN_RESULT = {
    "scheduled": True,
    "batchRunId": "batch_1",
    "setId": "set_1",
    "jobCount": 1,
    "skippedArchived": {"scenarios": [], "targets": []},
    "items": [],
    "runPlanId": "run_plan_1",
    "planName": "Refunds prompt_1",
    "created": True,
    "platformUrl": "https://app.langwatch.ai/p/project_1/simulations/set_1",
}


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
    payload: Any = TEST_SUITE, status: int = 200
) -> Tuple[TestSuitesFacade, List[Tuple[str, httpx.URL, Optional[Dict[str, Any]]]]]:
    """A facade whose transport records every call and answers `payload`."""
    calls: List[Tuple[str, httpx.URL, Optional[Dict[str, Any]]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url, body))
        return httpx.Response(status, json=payload)

    return TestSuitesFacade(FakeRestClient(handler)), calls


# @scenario "Listing test suites"
def test_list_reads_the_test_suites_route():
    facade, calls = recorder(payload=[TEST_SUITE])

    rows = facade.list()

    method, url, _ = calls[0]
    assert method == "GET"
    assert url.path == "/api/v1/test-suites"
    assert rows == [TEST_SUITE]


# @scenario "Creating a test suite sends the name alone"
def test_create_posts_only_the_name():
    facade, calls = recorder(status=201)

    created = facade.create(name="Refunds")

    method, url, body = calls[0]
    assert method == "POST"
    assert url.path == "/api/v1/test-suites"
    assert body == {"name": "Refunds"}
    assert created["id"] == "suite_1"


# @scenario "Reading a test suite returns the scenarios filed under it"
def test_get_reads_one_suite_with_its_scenarios():
    facade, calls = recorder()

    suite = facade.get("suite_1")

    method, url, _ = calls[0]
    assert method == "GET"
    assert url.path == "/api/v1/test-suites/suite_1"
    assert suite["scenarios"] == [{"id": "scenario_1", "name": "Refund over the limit"}]


# @scenario "Renaming a test suite"
def test_rename_patches_the_suite_with_the_new_name():
    facade, calls = recorder()

    facade.rename("suite_1", name="Refunds and chargebacks")

    method, url, body = calls[0]
    assert method == "PATCH"
    assert url.path == "/api/v1/test-suites/suite_1"
    assert body == {"name": "Refunds and chargebacks"}


# @scenario "Archiving a test suite"
def test_archive_deletes_the_suite_route():
    facade, calls = recorder(payload={"id": "suite_1", "archived": True})

    archived = facade.archive("suite_1")

    method, url, _ = calls[0]
    assert method == "DELETE"
    assert url.path == "/api/v1/test-suites/suite_1"
    assert archived == {"id": "suite_1", "archived": True}


# @scenario "Running a test suite sends the targets and lets the server name the plan"
def test_run_posts_the_targets_and_no_name():
    facade, calls = recorder(payload=RUN_RESULT)

    result = facade.run("suite_1", targets=[TARGET])

    method, url, body = calls[0]
    assert method == "POST"
    assert url.path == "/api/v1/test-suites/suite_1/run"
    assert body == {"targets": [TARGET]}
    assert result["planName"] == "Refunds prompt_1"


# @scenario "Running a test suite under a name of the caller's choosing"
def test_run_carries_every_field_the_caller_gave():
    facade, calls = recorder(payload=RUN_RESULT)

    facade.run(
        "suite_1",
        targets=[TARGET],
        name="Nightly refunds",
        repeat_count=2,
        simulator_model="openai/gpt-5-mini",
        judge_model="openai/gpt-5-mini",
        parameters={"account_tier": "gold"},
        note="after the prompt change",
        idempotency_key="run-1",
    )

    assert calls[0][2] == {
        "targets": [TARGET],
        "name": "Nightly refunds",
        "repeatCount": 2,
        "simulatorModel": "openai/gpt-5-mini",
        "judgeModel": "openai/gpt-5-mini",
        "idempotencyKey": "run-1",
        "parameters": {"account_tier": "gold"},
        "note": "after the prompt change",
    }


# @scenario "A refusal in the legacy envelope still reaches the caller as a detail"
def test_a_legacy_error_body_still_carries_its_detail_into_the_message():
    facade, _ = recorder(payload={"error": "Test suite not found"}, status=404)

    with pytest.raises(LangWatchApiNotFoundError) as caught:
        facade.get("suite_missing")

    assert caught.value.status == 404
    assert "Test suite not found" in str(caught.value)


# @scenario "The suites facade tells its callers it is deprecated"
def test_the_suites_facade_warns_that_it_is_deprecated():
    client = FakeRestClient(lambda _: httpx.Response(200, json={}))

    with pytest.warns(DeprecationWarning, match="run_plans and langwatch.test_suites"):
        SuitesFacade(client)


# @scenario "The run_plans facade stays reachable after test_suites is used"
def test_run_plans_stays_a_facade_after_test_suites_is_read():
    # A fresh interpreter: this test module already imported langwatch.run_plans
    # by name, which binds the module on the package before any facade is read.
    import subprocess
    import sys

    script = (
        "import langwatch\n"
        "langwatch.setup(api_key='sk-lw-test', endpoint_url='http://localhost:9')\n"
        "langwatch.test_suites\n"
        "kind = type(langwatch.run_plans).__name__\n"
        "assert kind == 'RunPlansFacade', kind\n"
    )
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
