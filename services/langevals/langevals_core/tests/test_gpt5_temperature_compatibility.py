"""
Unit tests for the gpt-5-family temperature normalization applied by
langevals' litellm patch.

Exercised at the patch seam (`patch_litellm_params`), which every litellm
call in langevals flows through, so what is asserted is the request that
actually leaves langevals. No API keys and no network.

Spec: specs/evaluators/langevals-gpt5-temperature-compatibility.feature
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


# @scenario "A judge pinned cold still reaches a model that only runs at its default temperature"
def test_pins_gpt5_family_to_the_only_accepted_temperature():
    kwargs = patch_litellm_params({"model": "openai/gpt-5-mini", "temperature": 0.0})

    assert kwargs["temperature"] == 1.0


# @scenario "A judge on a pinned model does not get the determinism it asked for"
def test_overrides_a_temperature_the_caller_chose():
    kwargs = patch_litellm_params({"model": "openai/gpt-5.6-sol", "temperature": 0.3})

    assert kwargs["temperature"] == 1.0


# @scenario "Every other model keeps the temperature the evaluator chose"
def test_leaves_other_models_at_the_configured_temperature():
    kwargs = patch_litellm_params(
        {"model": "anthropic/claude-sonnet-4-6", "temperature": 0.0}
    )

    assert kwargs["temperature"] == 0.0


# @scenario "A model in the family that does accept a temperature keeps the one it was given"
@pytest.mark.parametrize(
    "model", ["openai/gpt-5-image", "openai/gpt-5-image-mini"]
)
def test_leaves_the_image_models_of_the_family_alone(model):
    kwargs = patch_litellm_params({"model": model, "temperature": 0.0})

    assert kwargs["temperature"] == 0.0


# @scenario "An Azure deployment of a pinned model is recognised by what the request asked for"
def test_pins_an_azure_deployment_named_after_nothing_recognisable(monkeypatch):
    monkeypatch.setenv("AZURE_DEPLOYMENT_NAME", "prod-judge")

    kwargs = patch_litellm_params({"model": "azure/gpt-5-mini", "temperature": 0.0})

    # The deployment rewrite has taken the family name out of the model, which
    # is exactly why the check reads what the request originally asked for.
    assert kwargs["model"] == "azure/prod-judge"
    assert kwargs["temperature"] == 1.0


# @scenario "A temperature arriving as a request setting is normalized too"
def test_pins_a_temperature_arriving_as_a_request_setting(monkeypatch):
    monkeypatch.setenv("X_LITELLM_temperature", "0.0")

    kwargs = patch_litellm_params({"model": "openai/gpt-5-mini"})

    assert kwargs["temperature"] == 1.0


# @scenario "A call that never named a temperature is left alone"
def test_leaves_an_unset_temperature_unset():
    kwargs = patch_litellm_params({"model": "openai/gpt-5-mini"})

    assert "temperature" not in kwargs


def test_leaves_the_default_temperature_untouched():
    kwargs = patch_litellm_params({"model": "openai/gpt-5-mini", "temperature": 1.0})

    assert kwargs["temperature"] == 1.0
