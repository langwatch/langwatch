"""
An evaluator's output token limit goes out under the name the model catalog
records for its model.

The stub stands in for the provider, so every assertion is about the request
that actually leaves langevals. The catalog is the committed one, read from the
checkout the way a development run reads it. No API keys and no network.

Spec: specs/model-providers/output-tokens-parameter.feature
"""

import os

import pytest

from langevals_core import litellm_patch
from langevals_core.litellm_patch import patch_litellm
from langevals_core.model_capabilities import output_tokens_parameter

# OpenAI generations newer than litellm's own name matching, and the ones the
# catalog marks as refusing max_tokens.
MARKED_MODEL = "openai/gpt-6-astra"
UNMARKED_MODEL = "openai/gpt-4.1"
UNKNOWN_MODEL = "openai/ft:gpt-4.1:acme::judge"


class _Provider:
    def __init__(self):
        self.requests: list[dict] = []

    def __call__(self, *args, **kwargs):
        self.requests.append(kwargs)
        return "verdict response"

    async def acall(self, *args, **kwargs):
        return self(*args, **kwargs)

    @property
    def last_request(self) -> dict:
        return self.requests[-1]


@pytest.fixture
def provider(monkeypatch):
    """The real patched path over a stub provider, with no ambient X_LITELLM_
    settings or Azure deployment name."""
    for key in list(os.environ):
        if key.startswith("X_LITELLM_"):
            monkeypatch.delenv(key)
    monkeypatch.delenv("AZURE_DEPLOYMENT_NAME", raising=False)

    patch_litellm()
    stub = _Provider()
    monkeypatch.setitem(litellm_patch.originals, "completion", stub)
    monkeypatch.setitem(litellm_patch.originals, "acompletion", stub.acall)
    return stub


def judge_request(model: str, **overrides) -> dict:
    request = dict(
        model=model,
        messages=[{"role": "user", "content": "Is the user frustrated?"}],
    )
    request.update(overrides)
    return request


# @scenario "A judge on a model that takes max_completion_tokens reaches the model"
def test_marked_model_gets_max_completion_tokens(provider):
    litellm_patch.litellm.completion(**judge_request(MARKED_MODEL, max_tokens=4096))

    assert provider.last_request["max_completion_tokens"] == 4096
    assert "max_tokens" not in provider.last_request


# @scenario "A judge on a model that takes max_completion_tokens reaches the model"
def test_limit_from_the_evaluator_settings_is_renamed_too(provider, monkeypatch):
    """The app sends an evaluator's Max Tokens setting as X_LITELLM_max_tokens,
    which the patch merges into the request: the path the paused online
    evaluations took."""
    monkeypatch.setenv("X_LITELLM_max_tokens", "128000")

    litellm_patch.litellm.completion(**judge_request(MARKED_MODEL))

    assert provider.last_request["max_completion_tokens"] == 128000
    assert "max_tokens" not in provider.last_request


# @scenario "A judge on a model that takes max_completion_tokens reaches the model"
@pytest.mark.anyio
async def test_awaited_judge_on_marked_model_gets_max_completion_tokens(provider):
    await litellm_patch.litellm.acompletion(
        **judge_request(MARKED_MODEL, max_tokens=4096)
    )

    assert provider.last_request["max_completion_tokens"] == 4096
    assert "max_tokens" not in provider.last_request


# @scenario "An Azure deployment of a marked model is sent the name its model takes"
def test_azure_deployment_of_marked_model_gets_max_completion_tokens(
    provider, monkeypatch
):
    monkeypatch.setenv("AZURE_DEPLOYMENT_NAME", "prod-judge")

    litellm_patch.litellm.completion(
        **judge_request("azure/gpt-6-astra", max_tokens=4096)
    )

    assert provider.last_request["model"] == "azure/prod-judge"
    assert provider.last_request["max_completion_tokens"] == 4096
    assert "max_tokens" not in provider.last_request


# @scenario "A model that takes max_tokens keeps getting max_tokens"
@pytest.mark.parametrize("model", [UNMARKED_MODEL, "azure/gpt-4o"])
def test_unmarked_model_keeps_max_tokens(provider, model):
    litellm_patch.litellm.completion(**judge_request(model, max_tokens=4096))

    assert provider.last_request["max_tokens"] == 4096
    assert "max_completion_tokens" not in provider.last_request


# @scenario "A model the catalog does not know keeps the request it gets today"
def test_unknown_model_keeps_max_tokens(provider):
    assert output_tokens_parameter(UNKNOWN_MODEL) is None

    litellm_patch.litellm.completion(**judge_request(UNKNOWN_MODEL, max_tokens=4096))

    assert provider.last_request["max_tokens"] == 4096
    assert "max_completion_tokens" not in provider.last_request


# @scenario "A limit the caller already named max_completion_tokens is kept"
def test_explicit_max_completion_tokens_is_kept(provider, monkeypatch):
    monkeypatch.setenv("X_LITELLM_max_tokens", "128000")

    litellm_patch.litellm.completion(
        **judge_request(MARKED_MODEL, max_completion_tokens=2048)
    )

    assert provider.last_request["max_completion_tokens"] == 2048
    assert "max_tokens" not in provider.last_request


class TestOutputTokensParameter:
    def test_reads_the_mark_from_the_catalog(self):
        assert output_tokens_parameter(MARKED_MODEL) == "max_completion_tokens"
        assert output_tokens_parameter(UNMARKED_MODEL) == "max_tokens"

    def test_looks_an_azure_model_up_by_its_openai_entry(self):
        assert output_tokens_parameter("azure/gpt-6-astra") == "max_completion_tokens"
        assert output_tokens_parameter("azure/gpt-4o") == "max_tokens"

    def test_knows_nothing_without_a_model(self):
        assert output_tokens_parameter(None) is None
