"""
Unit tests for the Claude-model sampling normalization applied by langevals'
litellm patch: these models reject a request naming both `temperature` and
`top_p`, so only the temperature is allowed to leave.

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


# @scenario "A judge asking for both sampling knobs still reaches a model that accepts only one"
def test_drops_the_top_p_when_both_knobs_name_a_claude_model():
    kwargs = patch_litellm_params(
        {"model": "anthropic/claude-sonnet-4-5", "temperature": 0.0, "top_p": 0.9}
    )

    assert "top_p" not in kwargs


# @scenario "The temperature is the knob that survives"
def test_keeps_the_temperature_the_evaluator_chose():
    kwargs = patch_litellm_params(
        {"model": "anthropic/claude-sonnet-4-5", "temperature": 0.3, "top_p": 0.5}
    )

    assert kwargs["temperature"] == 0.3
    assert "top_p" not in kwargs


# @scenario "A top_p arriving as a request setting conflicts all the same"
def test_drops_a_top_p_arriving_as_a_request_setting(monkeypatch):
    monkeypatch.setenv("X_LITELLM_top_p", "0.9")

    kwargs = patch_litellm_params(
        {"model": "anthropic/claude-sonnet-4-5", "temperature": 0.0}
    )

    assert "top_p" not in kwargs


# @scenario "A Claude model is recognised behind any provider route"
@pytest.mark.parametrize(
    "model",
    [
        "bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0",
        "vertex_ai/claude-sonnet-4-5",
    ],
)
def test_recognises_a_claude_model_behind_a_cloud_provider_route(model):
    kwargs = patch_litellm_params({"model": model, "temperature": 0.0, "top_p": 0.9})

    assert "top_p" not in kwargs


# @scenario "Either knob alone is delivered as given"
def test_leaves_a_lone_top_p_alone():
    kwargs = patch_litellm_params({"model": "anthropic/claude-sonnet-4-5", "top_p": 0.9})

    assert kwargs["top_p"] == 0.9


# @scenario "Either knob alone is delivered as given"
def test_leaves_a_lone_temperature_alone():
    kwargs = patch_litellm_params(
        {"model": "anthropic/claude-sonnet-4-5", "temperature": 0.0}
    )

    assert kwargs["temperature"] == 0.0


# @scenario "Every other model keeps both knobs"
def test_leaves_other_models_with_both_knobs():
    kwargs = patch_litellm_params(
        {"model": "gemini/gemini-2.5-flash", "temperature": 0.0, "top_p": 0.9}
    )

    assert kwargs["temperature"] == 0.0
    assert kwargs["top_p"] == 0.9
