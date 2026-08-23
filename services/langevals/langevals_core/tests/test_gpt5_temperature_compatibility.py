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
        if key.startswith("X_LITELLM_"):
            monkeypatch.delenv(key)


# @scenario "A judge pinned cold still reaches a model that only runs at its default temperature"
def test_pins_gpt5_family_to_the_only_accepted_temperature():
    kwargs = patch_litellm_params(
        {"model": "openai/gpt-5-mini", "temperature": 0.0}
    )

    assert kwargs["temperature"] == 1.0


def test_pins_user_configured_gpt5_judges_too():
    kwargs = patch_litellm_params(
        {"model": "openai/gpt-5.6-sol", "temperature": 0.3}
    )

    assert kwargs["temperature"] == 1.0


# @scenario "Every other model keeps the temperature the evaluator chose"
def test_leaves_other_models_at_the_configured_temperature():
    kwargs = patch_litellm_params(
        {"model": "openai/gpt-4o-mini", "temperature": 0.0}
    )

    assert kwargs["temperature"] == 0.0


# @scenario "A call that never named a temperature is left alone"
def test_leaves_an_unset_temperature_unset():
    kwargs = patch_litellm_params({"model": "openai/gpt-5-mini"})

    assert "temperature" not in kwargs


def test_leaves_the_default_temperature_untouched():
    kwargs = patch_litellm_params(
        {"model": "openai/gpt-5-mini", "temperature": 1.0}
    )

    assert kwargs["temperature"] == 1.0
