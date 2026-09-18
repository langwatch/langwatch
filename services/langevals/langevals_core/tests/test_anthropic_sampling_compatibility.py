"""
Unit tests for the Claude temperature/top_p rule applied by langevals'
litellm patch.

Exercised at the patch seam (`patch_litellm_params`), which every litellm
call in langevals flows through, so what is asserted is the request that
actually leaves langevals. No API keys and no network.

Spec: specs/evaluators/langevals-anthropic-sampling-compatibility.feature
"""

import pytest

from langevals_core.litellm_patch import patch_litellm_params


@pytest.fixture(autouse=True)
def scrubbed_litellm_env(monkeypatch):
    """A developer's X_LITELLM_* variables must not steer these assertions."""
    import os

    for key in list(os.environ):
        if key.startswith("X_LITELLM_") or key == "AZURE_DEPLOYMENT_NAME":
            monkeypatch.delenv(key)


# @scenario "A judge configured with both temperature and top_p still reaches a Claude model"
def test_drops_top_p_when_temperature_is_also_set_on_claude():
    kwargs = patch_litellm_params(
        {"model": "anthropic/claude-sonnet-4-5", "temperature": 1.0, "top_p": 1.0}
    )

    assert kwargs["temperature"] == 1.0
    assert "top_p" not in kwargs


# @scenario "A judge configured with both temperature and top_p still reaches a Claude model"
def test_the_pair_arriving_through_request_env_is_resolved_the_same_way(monkeypatch):
    monkeypatch.setenv("X_LITELLM_temperature", "1")
    monkeypatch.setenv("X_LITELLM_top_p", "1")

    kwargs = patch_litellm_params({"model": "anthropic/claude-haiku-4-5"})

    assert kwargs["temperature"] == 1.0
    assert "top_p" not in kwargs


# @scenario "A Claude judge configured with top_p alone keeps it"
def test_keeps_top_p_when_it_is_the_only_sampling_parameter():
    kwargs = patch_litellm_params(
        {"model": "anthropic/claude-sonnet-4-5", "top_p": 0.9}
    )

    assert kwargs["top_p"] == 0.9
    assert "temperature" not in kwargs


# @scenario "A Claude model served by another provider gets the same treatment"
@pytest.mark.parametrize(
    "model",
    [
        "bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0",
        "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "vertex_ai/claude-opus-4-1",
    ],
)
def test_applies_to_claude_on_other_providers(model):
    kwargs = patch_litellm_params(
        {"model": model, "temperature": 0.2, "top_p": 0.9}
    )

    assert kwargs["temperature"] == 0.2
    assert "top_p" not in kwargs


# @scenario "A judge on a model that accepts the pair keeps both"
def test_leaves_other_models_alone():
    kwargs = patch_litellm_params(
        {"model": "openai/gpt-4.1-mini", "temperature": 0.5, "top_p": 0.9}
    )

    assert kwargs["temperature"] == 0.5
    assert kwargs["top_p"] == 0.9
