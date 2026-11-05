"""Unit coverage for reading agents and evaluators at a deploy label or version.

Transport is a mounted httpx.MockTransport, so the tests assert on the calls
the facades make rather than on a live API.

Spec: modules/agent/specs/agent-versioning.feature,
modules/evaluator/specs/evaluator-versioning.feature
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
