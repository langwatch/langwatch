"""Unit coverage for the run plans facade: every method hits its route with
the right verb, query and body, the scope object is built from the mode plus
the list that mode reads, and a mode whose list is missing is refused before
anything leaves the process. Transport is a mounted httpx.MockTransport, so
the assertions are on the bytes that leave the process.

Spec: specs/python-sdk/run-plans-and-test-suites.feature
"""

import json
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

import langwatch
from langwatch.api_errors import LangWatchApiNotFoundError
from langwatch.run_plans import RunPlansFacade

TARGET = {"type": "http", "referenceId": "agent_1"}

RUN_RESULT = {
    "scheduled": True,
    "batchRunId": "batch_1",
    "setId": "set_1",
    "jobCount": 2,
    "skippedArchived": {"scenarios": [], "targets": []},
    "items": [],
    "runPlanId": "run_plan_1",
    "planName": "Nightly",
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
    payload: Any = RUN_RESULT, status: int = 200
) -> Tuple[RunPlansFacade, List[Tuple[str, httpx.URL, Optional[Dict[str, Any]]]]]:
    """A facade whose transport records every call and answers `payload`."""
    calls: List[Tuple[str, httpx.URL, Optional[Dict[str, Any]]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url, body))
        return httpx.Response(status, json=payload)

    return RunPlansFacade(FakeRestClient(handler)), calls


# @scenario "Running under a name sends the name and the configuration together"
def test_run_posts_the_name_and_config_to_the_run_route():
    facade, calls = recorder()

    result = facade.run(
        targets=[TARGET],
        name="Nightly",
        repeat_count=3,
        simulator_model="openai/gpt-5-mini",
        judge_model="openai/gpt-5-mini",
    )

    method, url, body = calls[0]
    assert method == "POST"
    assert url.path == "/api/v1/run-plans/run"
    assert body == {
        "name": "Nightly",
        "config": {
            "scope": {"mode": "all"},
            "targets": [TARGET],
            "repeatCount": 3,
            "simulatorModel": "openai/gpt-5-mini",
            "judgeModel": "openai/gpt-5-mini",
        },
    }
    assert result["runPlanId"] == "run_plan_1"


# @scenario "A run with no name lets the server name the plan"
def test_run_without_a_name_sends_no_name_field():
    facade, calls = recorder()

    facade.run(targets=[TARGET])

    assert "name" not in (calls[0][2] or {})


# @scenario "The default scope covers every scenario of the project"
def test_run_defaults_to_the_all_scope():
    facade, calls = recorder()

    facade.run(targets=[TARGET])

    assert (calls[0][2] or {})["config"]["scope"] == {"mode": "all"}


# @scenario "A folder scope carries the folder ids the caller named"
def test_run_with_a_folder_scope_carries_the_folder_ids():
    facade, calls = recorder()

    facade.run(targets=[TARGET], scope="folders", folder_ids=["fold_1", "fold_2"])

    assert (calls[0][2] or {})["config"]["scope"] == {
        "mode": "folders",
        "folderIds": ["fold_1", "fold_2"],
    }


# @scenario "A label scope carries the labels the caller named"
def test_run_with_a_label_scope_carries_the_labels():
    facade, calls = recorder()

    facade.run(targets=[TARGET], scope="labels", labels=["refunds", "billing"])

    assert (calls[0][2] or {})["config"]["scope"] == {
        "mode": "labels",
        "labels": ["refunds", "billing"],
    }


# @scenario "A hand-picked scope carries the case ids as the configuration's scenario ids"
def test_run_with_a_cases_scope_sends_the_ids_beside_the_scope():
    facade, calls = recorder()

    facade.run(
        targets=[TARGET], scope="cases", scenario_ids=["scenario_1", "scenario_2"]
    )

    config = (calls[0][2] or {})["config"]
    assert config["scope"] == {"mode": "cases"}
    assert config["scenarioIds"] == ["scenario_1", "scenario_2"]


# @scenario "The run inputs the caller left out are absent from the body"
def test_run_omits_every_optional_field_the_caller_did_not_give():
    facade, calls = recorder()

    facade.run(targets=[TARGET])

    assert calls[0][2] == {"config": {"scope": {"mode": "all"}, "targets": [TARGET]}}


# @scenario "The run inputs the caller gave ride beside the configuration"
def test_run_sends_parameters_note_and_idempotency_key_outside_the_config():
    facade, calls = recorder()

    facade.run(
        targets=[TARGET],
        parameters={"account_tier": "gold", "seats": 12},
        note="checking the refund flow",
        idempotency_key="run-1",
    )

    body = calls[0][2] or {}
    assert body["parameters"] == {"account_tier": "gold", "seats": 12}
    assert body["note"] == "checking the refund flow"
    assert body["idempotencyKey"] == "run-1"
    assert set(body["config"]) == {"scope", "targets"}


# @scenario "A folder scope with no folder ids is refused before the request"
def test_a_folder_scope_without_folder_ids_is_refused_locally():
    facade, calls = recorder()

    with pytest.raises(ValueError, match="folder_ids"):
        facade.run(targets=[TARGET], scope="folders")

    assert calls == []


# @scenario "A label scope with no labels is refused before the request"
def test_a_label_scope_without_labels_is_refused_locally():
    facade, calls = recorder()

    with pytest.raises(ValueError, match="labels"):
        facade.run(targets=[TARGET], scope="labels")

    assert calls == []


# @scenario "A hand-picked scope with no case ids is refused before the request"
def test_a_cases_scope_without_scenario_ids_is_refused_locally():
    facade, calls = recorder()

    with pytest.raises(ValueError, match="scenario_ids"):
        facade.run(targets=[TARGET], scope="cases")

    assert calls == []


# @scenario "A scope mode the platform does not have is refused before the request"
def test_an_unknown_scope_mode_is_refused_locally():
    facade, calls = recorder()

    with pytest.raises(ValueError, match="all, folders, labels, cases"):
        facade.run(targets=[TARGET], scope="everything")

    assert calls == []


# @scenario "Re-running a plan sends the run inputs and nothing else"
def test_rerun_posts_only_the_run_inputs_to_the_plan_s_run_route():
    facade, calls = recorder()

    facade.rerun("run_plan_1", note="after the prompt change")

    method, url, body = calls[0]
    assert method == "POST"
    assert url.path == "/api/v1/run-plans/run_plan_1/run"
    assert body == {"note": "after the prompt change"}


# @scenario "Listing run plans leaves the archived ones out by default"
def test_list_asks_for_the_live_plans_by_default():
    facade, calls = recorder(payload=[{"id": "run_plan_1"}])

    rows = facade.list()

    method, url, _ = calls[0]
    assert method == "GET"
    assert url.path == "/api/v1/run-plans"
    assert url.params["includeArchived"] == "false"
    assert rows == [{"id": "run_plan_1"}]


# @scenario "Listing run plans can ask for the archived ones as well"
def test_list_can_ask_for_the_archived_plans_too():
    facade, calls = recorder(payload=[])

    facade.list(include_archived=True)

    assert calls[0][1].params["includeArchived"] == "true"


# @scenario "Reading one run plan by id"
def test_get_reads_one_plan_by_id():
    facade, calls = recorder(payload={"id": "run_plan_1", "name": "Nightly"})

    plan = facade.get("run_plan_1")

    method, url, _ = calls[0]
    assert method == "GET"
    assert url.path == "/api/v1/run-plans/run_plan_1"
    assert plan == {"id": "run_plan_1", "name": "Nightly"}


# @scenario "Archiving a run plan"
def test_archive_deletes_the_plan_route():
    facade, calls = recorder(payload={"id": "run_plan_1", "archived": True})

    archived = facade.archive("run_plan_1")

    method, url, _ = calls[0]
    assert method == "DELETE"
    assert url.path == "/api/v1/run-plans/run_plan_1"
    assert archived == {"id": "run_plan_1", "archived": True}


# @scenario "An id with a slash stays one path segment"
def test_an_id_carrying_a_slash_is_percent_encoded():
    facade, calls = recorder(payload={})

    facade.get("run_plan_1/../secrets")

    assert calls[0][1].raw_path.decode() == (
        "/api/v1/run-plans/run_plan_1%2F..%2Fsecrets"
    )


# @scenario "A refused call raises the typed error for its status"
def test_a_refused_read_raises_the_typed_error_with_the_platform_code():
    facade, _ = recorder(
        payload={
            "error": {
                "type": "not_found",
                "code": "not_found",
                "message": "Run plan not found",
                "trace_id": "trace_1",
            }
        },
        status=404,
    )

    with pytest.raises(LangWatchApiNotFoundError) as caught:
        facade.get("run_plan_missing")

    assert caught.value.status == 404
    assert caught.value.code == "not_found"
    assert "Run plan not found" in str(caught.value)


# @scenario "Both new facades are reachable from the SDK entry point"
def test_run_plans_and_test_suites_resolve_from_the_package_entry_point(monkeypatch):
    instance = SimpleNamespace(
        rest_api_client=FakeRestClient(lambda _: httpx.Response(200, json={}))
    )
    for name in ("run_plans", "test_suites"):
        monkeypatch.setattr(f"langwatch.{name}.ensure_setup", lambda: None)
        monkeypatch.setattr(f"langwatch.{name}.get_instance", lambda: instance)
        monkeypatch.delitem(vars(langwatch), name, raising=False)

    from langwatch.test_suites import TestSuitesFacade

    assert isinstance(langwatch.run_plans, RunPlansFacade)
    assert isinstance(langwatch.test_suites, TestSuitesFacade)
    assert "run_plans" in langwatch.__all__
    assert "test_suites" in langwatch.__all__
