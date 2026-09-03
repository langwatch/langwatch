"""The ragas litellm client shim, against the langchain-openai client contract.

`model_to_langchain` hands `ChatOpenAI` a `LitellmCompletion` /
`AsyncLitellmCompletion` pair instead of real OpenAI clients, so every ragas
evaluator call routes through litellm. That only works while the shim serves
the surface langchain-openai actually calls: since langchain-openai 0.3 the
chat path is `client.with_raw_response.create(**payload)` followed by
`raw_response.parse()`, unconditionally. A shim exposing only `.create()`
crashes with AttributeError before a single provider call is made, taking
down every ragas evaluator on every provider.

These tests pin the contract at both levels: the langchain entry points the
shim must survive (`invoke` for the sync client, `ainvoke` for the async one),
and one ragas evaluator end to end, provider stubbed at
`litellm_patch.originals` exactly like the sibling credential-isolation tests,
so the whole real stack above litellm is exercised.
"""

import asyncio
import json
import os
import sys

import pytest

# Same import guard as the other files in this directory (they must agree,
# since the first file pytest collects is the one that actually imports the
# module): `langevals.server` reads sys.argv and DISABLE_EVALUATORS_PRELOAD at
# import time, and both are restored right after.
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

# The server captured its baseline while the temporary preload flag was set.
# Rebase it on the clean environment, so the drift tripwire compares against
# what the process actually holds.
server.original_env = os.environ.copy()

from langevals_core import litellm_patch
from langevals_core.request_env import request_env
from langevals_ragas.faithfulness import (
    RagasFaithfulnessEntry,
    RagasFaithfulnessEvaluator,
)
from langevals_ragas.lib.model_to_langchain import model_to_langchain


def canned_text_response(model: str, content: str):
    from litellm.files.main import ModelResponse

    return ModelResponse(
        model=model,
        choices=[
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": content},
            }
        ],
        usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    )


@pytest.fixture
def stubbed_provider(monkeypatch):
    """Stub `litellm_patch.originals` with per-call canned contents.

    Returns (calls, respond_with): `respond_with` queues the content of each
    successive provider response; once the queue drains the last content
    repeats, so retries don't fail the test for the wrong reason.
    """
    calls: list[dict] = []
    contents: list[str] = ["hello from litellm"]

    def recording_completion(*args, **kwargs):
        calls.append(
            {
                "model": kwargs.get("model"),
                "api_key": kwargs.get("api_key"),
                "api_base": kwargs.get("api_base"),
                "api_version": kwargs.get("api_version"),
            }
        )
        content = contents[min(len(calls) - 1, len(contents) - 1)]
        return canned_text_response(kwargs.get("model", "gpt-5-mini"), content)

    monkeypatch.setitem(litellm_patch.originals, "completion", recording_completion)

    def respond_with(*queued: str):
        contents[:] = list(queued)

    return calls, respond_with


def test_the_sync_shim_client_answers_a_langchain_invoke(stubbed_provider):
    calls, _ = stubbed_provider
    llm = model_to_langchain("openai/gpt-5-mini")

    with request_env({"OPENAI_API_KEY": "sentinel-openai-key"}):
        message = llm.invoke("Say hi")

    assert message.content == "hello from litellm"
    assert len(calls) == 1
    assert calls[0]["model"] == "openai/gpt-5-mini"
    assert calls[0]["api_key"] == "sentinel-openai-key"


def test_the_async_shim_client_answers_a_langchain_ainvoke(stubbed_provider):
    calls, _ = stubbed_provider
    llm = model_to_langchain("openai/gpt-5-mini")

    with request_env({"OPENAI_API_KEY": "sentinel-openai-key"}):
        message = asyncio.run(llm.ainvoke("Say hi"))

    assert message.content == "hello from litellm"
    assert len(calls) == 1
    assert calls[0]["model"] == "openai/gpt-5-mini"
    assert calls[0]["api_key"] == "sentinel-openai-key"


def test_a_ragas_evaluation_on_azure_reaches_litellm_and_scores(stubbed_provider):
    calls, respond_with = stubbed_provider
    # Faithfulness makes two provider calls in data-dependency order: first
    # statement generation, then the NLI verdict over those statements. Each
    # gets the JSON its ragas output schema expects, so the evaluation runs
    # the same path a real provider response would.
    respond_with(
        json.dumps({"statements": ["The answer is 42."]}),
        json.dumps(
            {
                "statements": [
                    {
                        "statement": "The answer is 42.",
                        "reason": "Supported by the context.",
                        "verdict": 1,
                    }
                ]
            }
        ),
    )

    evaluator = RagasFaithfulnessEvaluator(
        settings={"model": "azure/gpt-5-mini"},
        env={
            "AZURE_OPENAI_API_KEY": "sentinel-azure-key",
            "AZURE_OPENAI_ENDPOINT": "https://sentinel.openai.azure.com",
        },
    )
    results = evaluator.evaluate_batch(
        [
            RagasFaithfulnessEntry(
                input="What is the answer?",
                output="The answer is 42.",
                contexts=["The answer to everything is 42."],
            )
        ]
    )

    assert len(results) == 1
    assert results[0].status == "processed", getattr(results[0], "details", None)
    assert results[0].score == 1.0

    assert len(calls) >= 2
    for call in calls:
        assert call["model"] == "azure/gpt-5-mini"
        assert call["api_key"] == "sentinel-azure-key"
        assert call["api_base"] == "https://sentinel.openai.azure.com"
        assert call["api_version"] is not None
