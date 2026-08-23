"""Unit coverage for the suites facade's run body.

`params` is the whole request body and stays that way; `parameters` is the
named record of constants the run supplies, matching
`langwatch.experiment.run(slug, parameters=...)` and
`langwatch.workflow.run(workflow_id, parameters=...)`. Transport is a mounted
httpx.MockTransport, so the assertions are on the bytes that leave the process.

Spec: specs/scenarios/scenario-run-parameters.feature
"""

import json
from typing import Any, Dict, List, Optional

import httpx

from langwatch.suites import SuitesFacade


class FakeRestClient:
    """The one method the facade uses from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


def _facade() -> tuple[SuitesFacade, List[Optional[Dict[str, Any]]]]:
    bodies: List[Optional[Dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content) if request.content else None)
        return httpx.Response(200, json={"batchRunId": "batch_1", "jobCount": 2})

    return SuitesFacade(FakeRestClient(handler)), bodies


def test_run_sends_parameters_as_their_own_body_field():
    facade, bodies = _facade()

    facade.run("suite_1", parameters={"account_tier": "gold", "seats": 12})

    assert bodies[0] == {"parameters": {"account_tier": "gold", "seats": 12}}


def test_run_without_parameters_sends_the_body_it_always_did():
    facade, bodies = _facade()

    facade.run("suite_1", params={"idempotencyKey": "run-1"})

    assert bodies[0] == {"idempotencyKey": "run-1"}


def test_run_merges_parameters_into_the_caller_s_body():
    facade, bodies = _facade()

    facade.run(
        "suite_1",
        params={"idempotencyKey": "run-1"},
        parameters={"region": "eu-central"},
    )

    assert bodies[0] == {
        "idempotencyKey": "run-1",
        "parameters": {"region": "eu-central"},
    }


def test_run_leaves_the_caller_s_params_dict_untouched():
    facade, _ = _facade()
    params: Dict[str, Any] = {"idempotencyKey": "run-1"}

    facade.run("suite_1", params=params, parameters={"region": "eu-central"})

    assert params == {"idempotencyKey": "run-1"}


def test_explicit_parameters_win_over_a_parameters_key_inside_params():
    facade, bodies = _facade()

    facade.run(
        "suite_1",
        params={"parameters": {"region": "us-east"}},
        parameters={"region": "eu-central"},
    )

    assert bodies[0] == {"parameters": {"region": "eu-central"}}
