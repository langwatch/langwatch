"""Unit coverage for agent and evaluator labels and versions, and for creating evaluators.

Transport is a mounted httpx.MockTransport, so the tests assert on the calls
the facades make rather than on a live API.

Spec: modules/agent/specs/agent-versioning.feature,
modules/evaluator/specs/evaluator-versioning.feature,
modules/evaluator/specs/evaluator-create-via-api.feature
"""

import json
from typing import Any, Dict, List, Tuple

import httpx

from langwatch.agents import AgentsFacade
from langwatch.evaluators import EvaluatorApiService


class FakeRestClient:
    """The one method the facades use from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


class Recorder:
    """Answers every call with a small body and keeps what was asked."""

    def __init__(self) -> None:
        self.calls: List[Tuple[str, str, Dict[str, str], Any]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.calls.append(
            (request.method, request.url.path, dict(request.url.params), body)
        )
        return httpx.Response(200, json={"id": "row_1", "data": [], "labels": []})


# @scenario "The Python SDK reads an agent at a label and moves its labels"
def test_agents_read_at_a_label_and_move_labels():
    recorder = Recorder()
    agents = AgentsFacade(FakeRestClient(recorder.handler))  # type: ignore[arg-type]

    agents.get("agent_1", label="production")
    agents.get("agent_1", version=2)
    agents.list_versions("agent_1")
    agents.assign_label("agent_1", "production", 2)
    agents.remove_label("agent_1", "production")

    assert recorder.calls == [
        ("GET", "/api/v1/agents/agent_1", {"label": "production"}, None),
        ("GET", "/api/v1/agents/agent_1", {"version": "2"}, None),
        ("GET", "/api/v1/agents/agent_1/versions", {}, None),
        ("PUT", "/api/v1/agents/agent_1/labels/production", {}, {"version": 2}),
        ("DELETE", "/api/v1/agents/agent_1/labels/production", {}, None),
    ]


# @scenario "The Python SDK reads an evaluator at a label and moves its labels"
def test_evaluators_read_at_a_label_and_move_labels():
    recorder = Recorder()
    evaluators = EvaluatorApiService(FakeRestClient(recorder.handler))  # type: ignore[arg-type]

    evaluators.get("toxicity", label="production")
    evaluators.get("toxicity", version=2)
    evaluators.list_versions("evaluator_1")
    evaluators.assign_label("evaluator_1", "production", 2)
    evaluators.remove_label("evaluator_1", "production")

    assert recorder.calls == [
        ("GET", "/api/v1/evaluators/toxicity", {"label": "production"}, None),
        ("GET", "/api/v1/evaluators/toxicity", {"version": "2"}, None),
        ("GET", "/api/v1/evaluators/evaluator_1/versions", {}, None),
        ("PUT", "/api/v1/evaluators/evaluator_1/labels/production", {}, {"version": 2}),
        ("DELETE", "/api/v1/evaluators/evaluator_1/labels/production", {}, None),
    ]


class CreatedRecorder(Recorder):
    """Answers a create with the evaluator row the platform returns."""

    def handler(self, request: httpx.Request) -> httpx.Response:
        super().handler(request)
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "evaluator_1",
                "projectId": "project_1",
                "name": body["name"],
                "slug": "exact",
                "type": body.get("type", "evaluator"),
                "config": body["config"],
                "workflowId": body.get("workflowId"),
                "copiedFromEvaluatorId": None,
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:00.000Z",
                "fields": body["config"].get("inputs", []),
                "outputFields": [],
                "version": 1,
                "labels": [],
                "createdBy": None,
                "updatedBy": None,
                "platformUrl": "https://app.langwatch.test/p/evaluators",
            },
        )


# @scenario "The Python SDK creates a code evaluator"
def test_evaluators_create_a_code_evaluator():
    recorder = CreatedRecorder()
    evaluators = EvaluatorApiService(FakeRestClient(recorder.handler))  # type: ignore[arg-type]
    config = {
        "code": "class Code:\n    def __call__(self, output: str):\n        return {}\n",
        "inputs": [{"identifier": "output", "type": "str"}],
    }

    created = evaluators.create("Exact", config, type="code")

    assert recorder.calls == [
        ("POST", "/api/v1/evaluators", {}, {"name": "Exact", "type": "code", "config": config}),
    ]
    assert created["type"] == "code"


def test_evaluators_create_a_built_in_evaluator_by_default():
    recorder = CreatedRecorder()
    evaluators = EvaluatorApiService(FakeRestClient(recorder.handler))  # type: ignore[arg-type]

    evaluators.create("Exact", {"evaluatorType": "langevals/exact_match"})

    assert recorder.calls[0][3] == {
        "name": "Exact",
        "type": "evaluator",
        "config": {"evaluatorType": "langevals/exact_match"},
    }


def test_evaluators_create_a_workflow_evaluator():
    recorder = CreatedRecorder()
    evaluators = EvaluatorApiService(FakeRestClient(recorder.handler))  # type: ignore[arg-type]

    evaluators.create("Judge", {}, type="workflow", workflow_id="workflow_1")

    assert recorder.calls[0][3] == {
        "name": "Judge",
        "type": "workflow",
        "config": {},
        "workflowId": "workflow_1",
    }
