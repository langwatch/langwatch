"""Request credentials reach the model call and never the process environment.

Evaluators used to bridge request `env` to litellm by writing it into
`os.environ`, some of them the whole dict. That is a cross-request boundary:
with two evaluations in flight, whichever wrote last supplied credentials to
both. These tests pin the replacement contract for every family that used to
write:

- the request env is resolved into explicit litellm call arguments
  (api_key, api_base, api_version) by the patch layer, and
- `os.environ` is byte-identical before, during, and after the evaluation.

The provider is stubbed at the innermost layer, `litellm_patch.originals`,
which is the unpatched litellm entry point: everything above it, the
evaluator, dspy or langchain shims, and the whole patch pipeline, is real.
"""

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
from langevals_core.litellm_patch import patch_litellm_params
from langevals_core.request_env import request_env
from langevals_langevals.competitor_llm import CompetitorLLMEntry, CompetitorLLMEvaluator
from langevals_langevals.competitor_llm_function_call import (
    CompetitorLLMFunctionCallEntry,
    CompetitorLLMFunctionCallEvaluator,
)
from langevals_langevals.llm_boolean import CustomLLMBooleanEntry, CustomLLMBooleanEvaluator
from langevals_langevals.llm_category import CustomLLMCategoryEntry, CustomLLMCategoryEvaluator
from langevals_langevals.llm_score import CustomLLMScoreEntry, CustomLLMScoreEvaluator
from langevals_langevals.off_topic import OffTopicEntry, OffTopicEvaluator
from langevals_langevals.pairwise_compare import PairwiseCompareEntry, PairwiseCompareEvaluator
from langevals_langevals.query_resolution import (
    QueryResolutionEntry,
    QueryResolutionEvaluator,
)
from langevals_langevals.select_best_compare import (
    SelectBestCompareEntry,
    SelectBestCompareEvaluator,
)


def environment_snapshot() -> dict:
    # PYTEST_CURRENT_TEST is pytest's own per-phase marker and changes under
    # our feet; everything else must stay byte-identical.
    return {k: v for k, v in os.environ.items() if k != "PYTEST_CURRENT_TEST"}


# ---------------------------------------------------------------------------
# The resolution layer itself, kwargs in, kwargs out.
# ---------------------------------------------------------------------------


def test_azure_credentials_resolve_into_call_arguments():
    with request_env(
        {
            "AZURE_OPENAI_API_KEY": "req-azure-key",
            "AZURE_OPENAI_ENDPOINT": "https://req.example.com",
        }
    ):
        kwargs = patch_litellm_params({"model": "azure/gpt-4o"})
    assert kwargs["api_key"] == "req-azure-key"
    assert kwargs["api_base"] == "https://req.example.com"


def test_azure_litellm_names_win_over_the_openai_spellings():
    with request_env(
        {
            "AZURE_API_KEY": "litellm-name",
            "AZURE_OPENAI_API_KEY": "openai-name",
        }
    ):
        kwargs = patch_litellm_params({"model": "azure/gpt-4o"})
    assert kwargs["api_key"] == "litellm-name"


def test_openai_credentials_resolve_for_bare_model_names():
    with request_env({"OPENAI_API_KEY": "req-openai-key"}):
        kwargs = patch_litellm_params({"model": "gpt-5-mini"})
    assert kwargs["api_key"] == "req-openai-key"


def test_credentials_of_another_provider_do_not_apply():
    with request_env({"OPENAI_API_KEY": "req-openai-key"}):
        kwargs = patch_litellm_params({"model": "anthropic/claude-sonnet-5"})
    assert "api_key" not in kwargs


def test_an_explicit_call_argument_wins_over_the_request_env():
    with request_env({"AZURE_API_VERSION": "from-env"}):
        kwargs = patch_litellm_params(
            {"model": "azure/gpt-4o", "api_version": "explicit"}
        )
    assert kwargs["api_version"] == "explicit"


def test_x_litellm_variables_win_over_the_credential_mapping():
    with request_env(
        {"OPENAI_API_KEY": "mapped", "X_LITELLM_api_key": "passthrough"}
    ):
        kwargs = patch_litellm_params({"model": "openai/gpt-5-mini"})
    assert kwargs["api_key"] == "passthrough"


def test_the_deployment_name_rewrite_reads_the_request_env():
    with request_env({"AZURE_DEPLOYMENT_NAME": "my-deployment"}):
        kwargs = patch_litellm_params({"model": "azure/gpt-4o"})
    assert kwargs["model"] == "azure/my-deployment"
    with request_env({"AZURE_DEPLOYMENT_NAME": "my-deployment"}):
        kwargs = patch_litellm_params({"model": "openai/gpt-5-mini"})
    assert kwargs["model"] == "openai/gpt-5-mini"


def test_bedrock_credentials_resolve_into_call_arguments():
    """Temporary AWS credentials need all three parts on the call.

    An assumed role gives an access key, a secret and a session token, and
    the provider rejects the pair without the token.
    """
    with request_env(
        {
            "AWS_ACCESS_KEY_ID": "req-access-key",
            "AWS_SECRET_ACCESS_KEY": "req-secret-key",
            "AWS_SESSION_TOKEN": "req-session-token",
            "AWS_REGION_NAME": "eu-central-1",
        }
    ):
        kwargs = patch_litellm_params({"model": "bedrock/anthropic.claude-sonnet-4"})
    assert kwargs["aws_access_key_id"] == "req-access-key"
    assert kwargs["aws_secret_access_key"] == "req-secret-key"
    assert kwargs["aws_session_token"] == "req-session-token"
    assert kwargs["aws_region_name"] == "eu-central-1"


def test_vertex_credentials_resolve_from_the_request_env():
    with request_env({"GOOGLE_APPLICATION_CREDENTIALS": "req-google-credentials"}):
        kwargs = patch_litellm_params({"model": "vertex_ai/gemini-2.5-pro"})
    assert kwargs["vertex_credentials"] == "req-google-credentials"


def test_an_explicit_vertex_credential_wins_over_the_request_env():
    with request_env({"GOOGLE_APPLICATION_CREDENTIALS": "from-request"}):
        kwargs = patch_litellm_params(
            {"model": "vertex_ai/gemini-2.5-pro", "vertex_credentials": "explicit"}
        )
    assert kwargs["vertex_credentials"] == "explicit"


def test_the_server_vertex_credential_reaches_vertex_calls_only(monkeypatch):
    """The server's own Google credentials are a vertex fallback.

    They belong to the vertex call that has none of its own. Attaching them
    to a call for another provider gives it an argument it cannot use.
    """
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "server-google-credentials")

    with request_env({}):
        vertex = patch_litellm_params({"model": "vertex_ai/gemini-2.5-pro"})
        openai = patch_litellm_params({"model": "openai/gpt-5-mini"})

    assert vertex["vertex_credentials"] == "server-google-credentials"
    assert "vertex_credentials" not in openai


def test_resolution_never_writes_the_environment():
    before = environment_snapshot()
    with request_env(
        {
            "AZURE_OPENAI_API_KEY": "req-azure-key",
            "X_LITELLM_api_key": "passthrough",
            "AZURE_DEPLOYMENT_NAME": "my-deployment",
        }
    ):
        patch_litellm_params({"model": "azure/gpt-4o"})
    assert environment_snapshot() == before


# ---------------------------------------------------------------------------
# Every evaluator family that used to write os.environ, end to end.
# ---------------------------------------------------------------------------


def canned_tool_call_response(model: str):
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
                            "function": {"name": "evaluation", "arguments": "{}"},
                        }
                    ],
                },
            }
        ],
        usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    )


@pytest.fixture
def captured_calls(monkeypatch):
    calls: list[dict] = []

    def recording_completion(*args, **kwargs):
        calls.append(
            {
                "api_key": kwargs.get("api_key"),
                "api_base": kwargs.get("api_base"),
                "api_version": kwargs.get("api_version"),
                "model": kwargs.get("model"),
                # What the process environment held at the exact moment of
                # the provider call, which is when a leaked credential would
                # be read.
                "global_openai_key": os.environ.get("OPENAI_API_KEY"),
                "global_azure_key": os.environ.get("AZURE_API_KEY")
                or os.environ.get("AZURE_OPENAI_API_KEY"),
            }
        )
        return canned_tool_call_response(kwargs.get("model", "gpt-5-mini"))

    monkeypatch.setitem(litellm_patch.originals, "completion", recording_completion)
    return calls


OPENAI_SENTINEL_ENV = {"OPENAI_API_KEY": "sentinel-openai-key"}
AZURE_SENTINEL_ENV = {
    "AZURE_OPENAI_API_KEY": "sentinel-azure-key",
    "AZURE_OPENAI_ENDPOINT": "https://sentinel.openai.azure.com",
}


text_entry = {"input": "What is the answer?", "output": "The answer is 42."}
EVALUATOR_CASES = [
    pytest.param(
        CustomLLMBooleanEvaluator,
        CustomLLMBooleanEntry(**text_entry),
        {"model": "openai/gpt-5-mini"},
        OPENAI_SENTINEL_ENV,
        "sentinel-openai-key",
        id="llm_boolean-openai",
    ),
    pytest.param(
        CustomLLMBooleanEvaluator,
        CustomLLMBooleanEntry(**text_entry),
        {"model": "azure/gpt-4o"},
        AZURE_SENTINEL_ENV,
        "sentinel-azure-key",
        id="llm_boolean-azure",
    ),
    pytest.param(
        CustomLLMScoreEvaluator,
        CustomLLMScoreEntry(**text_entry),
        {"model": "azure/gpt-4o"},
        AZURE_SENTINEL_ENV,
        "sentinel-azure-key",
        id="llm_score-azure",
    ),
    pytest.param(
        CustomLLMCategoryEvaluator,
        CustomLLMCategoryEntry(**text_entry),
        {"model": "azure/gpt-4o"},
        AZURE_SENTINEL_ENV,
        "sentinel-azure-key",
        id="llm_category-azure",
    ),
    pytest.param(
        PairwiseCompareEvaluator,
        PairwiseCompareEntry(
            input="Which is better?",
            candidate_a_id="a",
            candidate_a_output="first",
            candidate_b_id="b",
            candidate_b_output="second",
        ),
        {"model": "azure/gpt-4o"},
        AZURE_SENTINEL_ENV,
        "sentinel-azure-key",
        id="pairwise_compare-azure",
    ),
    pytest.param(
        SelectBestCompareEvaluator,
        SelectBestCompareEntry(
            input="Which is best?",
            candidates=[
                {"id": "a", "output": "first"},
                {"id": "b", "output": "second"},
            ],
        ),
        {"model": "azure/gpt-4o"},
        AZURE_SENTINEL_ENV,
        "sentinel-azure-key",
        id="select_best_compare-azure",
    ),
    pytest.param(
        OffTopicEvaluator,
        OffTopicEntry(input="Tell me about the weather"),
        {"model": "azure/gpt-4o"},
        AZURE_SENTINEL_ENV,
        "sentinel-azure-key",
        id="off_topic-azure",
    ),
    pytest.param(
        CompetitorLLMEvaluator,
        CompetitorLLMEntry(**text_entry),
        {"model": "azure/gpt-4o"},
        AZURE_SENTINEL_ENV,
        "sentinel-azure-key",
        id="competitor_llm-azure",
    ),
    pytest.param(
        CompetitorLLMFunctionCallEvaluator,
        CompetitorLLMFunctionCallEntry(**text_entry),
        {"model": "azure/gpt-4o"},
        AZURE_SENTINEL_ENV,
        "sentinel-azure-key",
        id="competitor_llm_function_call-azure",
    ),
    pytest.param(
        QueryResolutionEvaluator,
        QueryResolutionEntry(
            conversation=[{"input": "Where is my order?", "output": "It shipped."}]
        ),
        {"model": "azure/gpt-4o"},
        AZURE_SENTINEL_ENV,
        "sentinel-azure-key",
        id="query_resolution-azure",
    ),
]


@pytest.mark.parametrize(
    "evaluator_cls, entry, settings, env, expected_api_key", EVALUATOR_CASES
)
def test_the_request_credential_reaches_the_call_and_not_the_environment(
    captured_calls, evaluator_cls, entry, settings, env, expected_api_key
):
    before = environment_snapshot()

    evaluator = evaluator_cls(settings=settings, env=env)
    results = evaluator.evaluate_batch([entry])

    # The canned provider response carries an empty payload, so the
    # evaluator may report an error result; what matters here is that it
    # made its call and how. It must never swallow the whole batch.
    assert len(results) == 1
    assert environment_snapshot() == before
    assert len(captured_calls) >= 1
    for call in captured_calls:
        assert call["api_key"] == expected_api_key
        assert call["global_openai_key"] != "sentinel-openai-key"
        assert call["global_azure_key"] != "sentinel-azure-key"
        if call["model"].startswith("azure/"):
            assert call["api_base"] == "https://sentinel.openai.azure.com"
            assert call["api_version"] is not None


def test_the_ragas_helper_no_longer_writes_the_environment():
    """prepare_llm copied the whole request env into os.environ; now it must
    build its client without touching the process environment at all."""
    from langevals_ragas.lib.common import RagasSettings, prepare_llm
    from langevals_ragas.response_relevancy import RagasResponseRelevancyEvaluator

    before = environment_snapshot()
    evaluator = RagasResponseRelevancyEvaluator(
        settings={},
        env={"OPENAI_API_KEY": "sentinel-openai-key", "CUSTOM_VAR": "sentinel"},
    )
    prepare_llm(evaluator, settings=RagasSettings(model="azure/gpt-4o"))
    assert environment_snapshot() == before


def test_constructing_any_evaluator_leaves_the_environment_alone():
    """set_model_envs is gone: construction must not write a single variable.

    Sweeps every evaluator class the server loaded, so a future evaluator
    that reintroduces an environment write at construction fails here by
    name.
    """
    from langevals.utils import get_evaluator_classes

    sentinel_env = {
        "OPENAI_API_KEY": "sentinel-openai-key",
        "AZURE_OPENAI_API_KEY": "sentinel-azure-key",
        "X_LITELLM_api_key": "sentinel-passthrough",
        "SOME_CUSTOM_VARIABLE": "sentinel-custom",
    }
    constructed = 0
    before = environment_snapshot()
    for evaluator_package in server.evaluators.values():
        for evaluator_cls in get_evaluator_classes(evaluator_package):
            evaluator_cls(settings={}, env=dict(sentinel_env))
            constructed += 1
            assert environment_snapshot() == before, (
                f"{evaluator_cls.__name__} changed os.environ at construction"
            )
    assert constructed > 10
