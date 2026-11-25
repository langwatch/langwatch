"""
Unit tests for the temperature normalization applied by langevals' litellm
patch: the gpt-5 family pinned by name, and any other model pinned once it
refuses a temperature but its default at runtime.

The name-based pinning is exercised at `patch_litellm_params`; the refusal
retry drives the patched `litellm.completion` against a stub provider. Both
assert the request that leaves langevals. No API keys and no network.

Spec: specs/evaluators/langevals-gpt5-temperature-compatibility.feature
"""

import os

import litellm
import pytest

from langevals_core import litellm_patch
from langevals_core.litellm_patch import patch_litellm, patch_litellm_params

# The temperature rejection as the provider words it for openai/gpt-6-luna.
PROVIDER_TEMPERATURE_REFUSAL = (
    "litellm.BadRequestError: OpenAIException - Unsupported value: "
    "'temperature' does not support 0 with this model. Only the default (1) "
    "value is supported."
)

PROVIDER_TOOL_REASONING_REFUSAL = (
    "litellm.BadRequestError: OpenAIException - Function tools with "
    "reasoning_effort are not supported for gpt-7-new in "
    "/v1/chat/completions. To use function tools, use /v1/responses or set "
    "reasoning_effort to 'none'."
)

PROVIDER_ANSWER = "verdict response"

VERDICT_TOOL = {
    "type": "function",
    "function": {
        "name": "verdict",
        "parameters": {
            "type": "object",
            "properties": {"passed": {"type": "boolean"}},
            "required": ["passed"],
        },
    },
}


class _Provider:
    """Records each request langevals sends and raises the queued refusals
    first, or every time when `always` is set."""

    def __init__(self):
        self.requests: list[dict] = []
        self.refusals: list[BaseException] = []
        self.always: BaseException | None = None

    def __call__(self, *args, **kwargs):
        self.requests.append(kwargs)
        if self.always is not None:
            raise self.always
        if self.refusals:
            raise self.refusals.pop(0)
        return PROVIDER_ANSWER

    @property
    def last_request(self) -> dict:
        return self.requests[-1]


@pytest.fixture
def provider(monkeypatch):
    """The patched litellm entry point driving a stub provider, with the
    models learned at runtime cleared."""
    patch_litellm()
    stub = _Provider()
    monkeypatch.setitem(litellm_patch.originals, "completion", stub)
    monkeypatch.setattr(litellm_patch, "tool_reasoning_off_models", set())
    monkeypatch.setattr(litellm_patch, "temperature_pinned_models", set())
    monkeypatch.setattr(litellm_patch, "forced_tool_choice_refusers", set())
    return stub


@pytest.fixture(autouse=True)
def scrubbed_litellm_env(monkeypatch):
    """A developer's X_LITELLM_* variables must not steer these assertions."""
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


# @scenario "A model that refuses any temperature but its default is asked again at the default"
def test_refused_temperature_is_retried_at_the_default(provider):
    provider.refusals = [Exception(PROVIDER_TEMPERATURE_REFUSAL)]

    answer = litellm.completion(
        model="openai/gpt-7-new",
        messages=[{"role": "user", "content": "Is this correct?"}],
        temperature=0,
    )

    first, second = provider.requests
    assert first["temperature"] == 0
    assert second["temperature"] == 1.0
    assert answer == PROVIDER_ANSWER

    litellm.completion(
        model="openai/gpt-7-new",
        messages=[{"role": "user", "content": "Is this correct?"}],
        temperature=0,
    )
    assert len(provider.requests) == 3
    assert provider.last_request["temperature"] == 1.0


# @scenario "A model that refuses any temperature but its default is asked again at the default"
def test_temperature_and_reasoning_refusals_are_each_fixed_once(provider):
    provider.refusals = [
        Exception(PROVIDER_TOOL_REASONING_REFUSAL),
        Exception(PROVIDER_TEMPERATURE_REFUSAL),
    ]

    answer = litellm.completion(
        model="openai/gpt-7-new",
        messages=[{"role": "user", "content": "Is this correct?"}],
        tools=[VERDICT_TOOL],
        tool_choice={"type": "function", "function": {"name": "verdict"}},
        temperature=0,
    )

    assert len(provider.requests) == 3
    assert provider.last_request["reasoning_effort"] == "none"
    assert provider.last_request["temperature"] == 1.0
    assert answer == PROVIDER_ANSWER


# @scenario "A model that refuses any temperature but its default is asked again at the default"
def test_temperature_refused_again_at_the_default_reaches_the_caller(provider):
    refusal = Exception(PROVIDER_TEMPERATURE_REFUSAL)
    provider.always = refusal

    with pytest.raises(Exception) as raised:
        litellm.completion(
            model="openai/gpt-7-new",
            messages=[{"role": "user", "content": "Is this correct?"}],
            temperature=0,
        )

    assert raised.value is refusal
    assert [request["temperature"] for request in provider.requests] == [0, 1.0]
