"""An evaluator's model call the app routed through nlpgo reaches nlpgo, end to end.

The app posts an evaluation whose model block goes to nlpgo's proxy, with the
proxy and the engine's credential in request headers (ADR-203). These drive
the real evaluate route and stub the provider at the innermost layer, so they
pin what litellm is finally called with: the proxy, the signed bindings, and
the credential, which never appears on a call to anywhere else.

Scenarios: specs/security/org-private-model-endpoints.feature
"""

import json
import os
import sys

# Same import guard as the other files in this directory.
_original_argv = sys.argv
_original_preload = os.environ.get("DISABLE_EVALUATORS_PRELOAD")
sys.argv = ["server.py", "--only", "langevals,ragas"]
os.environ["DISABLE_EVALUATORS_PRELOAD"] = "1"
try:
    from langevals import server  # noqa: F401  (imports and patches litellm)
finally:
    sys.argv = _original_argv
    if _original_preload is None:
        os.environ.pop("DISABLE_EVALUATORS_PRELOAD", None)
    else:
        os.environ["DISABLE_EVALUATORS_PRELOAD"] = _original_preload

server.original_env = os.environ.copy()

import pytest
from fastapi.testclient import TestClient

from langevals_core import litellm_patch

PROXY = "http://langwatch-nlp-svc/go/proxy/v1"
SIGNED = {
    "x-litellm-model": "openai/judge",
    "x-litellm-api_base": "https://llm.internal.acme.test/v1",
    "X-LangWatch-Private-Endpoints": "payload.signature",
    "X-LangWatch-Project-Id": "acme-prod",
}
ENGINE_HEADERS = {
    "X-LangWatch-Engine-Proxy": PROXY,
    "X-LangWatch-NLP-Secret": "engine-secret",
}


def boolean_answer(model: str):
    from litellm.files.main import ModelResponse

    return ModelResponse(
        model=model,
        choices=[
            {
                "index": 0,
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "evaluation",
                                "arguments": json.dumps(
                                    {"reasoning": "fine", "final_answer": True}
                                ),
                            },
                        }
                    ],
                },
            }
        ],
        usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    )


@pytest.fixture
def calls(monkeypatch):
    seen: list[dict] = []

    def recording_completion(*args, **kwargs):
        seen.append(kwargs)
        return boolean_answer(kwargs.get("model") or "")

    monkeypatch.setitem(litellm_patch.originals, "completion", recording_completion)
    return seen


def evaluate(env: dict, headers: dict) -> list:
    response = TestClient(server.app).post(
        "/langevals/llm_boolean/evaluate",
        json={
            "data": [{"input": "hi", "output": "there"}],
            "settings": {"model": "openai/judge", "prompt": "Is it fine?"},
            "env": env,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


ROUTED_ENV = {
    "X_LITELLM_model": "openai/openai/judge",
    "X_LITELLM_api_base": PROXY,
    "X_LITELLM_api_key": "langwatch-engine-proxy",
    "X_LITELLM_extra_headers": json.dumps(SIGNED),
}


# @scenario "A langevals model call to a bound hostname goes through nlpgo"
def test_a_routed_judge_call_goes_to_the_proxy_with_the_bindings_and_the_credential(calls):
    evaluate(ROUTED_ENV, ENGINE_HEADERS)

    assert calls, "the judge never called its model"
    call = calls[0]
    assert call["api_base"] == PROXY
    assert call["extra_headers"] == {**SIGNED, "X-LangWatch-NLP-Secret": "engine-secret"}
    assert call["client"]._client.follow_redirects is False
    assert str(call["client"].base_url).rstrip("/") == PROXY


# @scenario "langevals sends the engine credential only to the engine proxy"
def test_a_direct_call_never_carries_the_credential_even_when_the_request_names_one(calls):
    env = {
        "X_LITELLM_model": "openai/judge",
        "X_LITELLM_api_base": "https://api.example.com/v1",
        "X_LITELLM_api_key": "customer-key",
    }

    evaluate(env, ENGINE_HEADERS)

    assert calls[0]["api_base"] == "https://api.example.com/v1"
    assert "engine-secret" not in json.dumps(calls[0], default=str)
    assert "client" not in calls[0]


def test_a_routed_call_without_the_engine_headers_carries_no_credential(calls):
    evaluate(ROUTED_ENV, {})

    assert calls[0]["api_base"] == PROXY
    assert calls[0]["extra_headers"] == SIGNED
