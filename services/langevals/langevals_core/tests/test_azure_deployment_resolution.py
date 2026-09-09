"""
Unit tests for how langevals settles which Azure deployment a call names.

Exercised at the patch seam (`patch_litellm_params`,
`patch_litellm_embedding_params`), which every litellm call in langevals
flows through, so what is asserted is the request that actually leaves
langevals. No API keys and no network.

Spec: specs/evaluators/evaluator-azure-deployment-and-embeddings-provider.feature
"""

import os

import pytest

from langevals_core.litellm_patch import (
    patch_litellm_embedding_params,
    patch_litellm_params,
)
from langevals_core.request_env import request_env


@pytest.fixture(autouse=True)
def scrubbed_litellm_env(monkeypatch):
    """A developer's own variables must not steer these assertions."""
    for key in list(os.environ):
        if key.startswith("X_LITELLM_") or key in (
            "AZURE_DEPLOYMENT_NAME",
            "AZURE_EMBEDDINGS_DEPLOYMENT_NAME",
        ):
            monkeypatch.delenv(key)


# @scenario "A deployment named as a call argument still selects the deployment"
def test_a_deployment_argument_selects_the_deployment():
    kwargs = patch_litellm_params(
        {"model": "azure/gpt-4o", "deployment": "prod-judge"}
    )

    assert kwargs["model"] == "azure/prod-judge"


# @scenario "The deployment name is never sent as a call argument"
def test_the_deployment_argument_does_not_survive_into_the_request():
    kwargs = patch_litellm_params(
        {"model": "azure/gpt-4o", "deployment": "prod-judge"}
    )

    assert "deployment" not in kwargs


# The environment is how the platform sends it, and it is the older of the
# two spellings — it stays the one that wins.
def test_the_environment_name_wins_over_a_call_argument(monkeypatch):
    monkeypatch.setenv("AZURE_DEPLOYMENT_NAME", "from-environment")

    kwargs = patch_litellm_params(
        {"model": "azure/gpt-4o", "deployment": "from-argument"}
    )

    assert kwargs["model"] == "azure/from-environment"


def test_a_deployment_name_does_not_divert_a_call_to_another_provider(monkeypatch):
    monkeypatch.setenv("AZURE_DEPLOYMENT_NAME", "prod-judge")

    kwargs = patch_litellm_params({"model": "openai/gpt-4o"})

    assert kwargs["model"] == "openai/gpt-4o"


# @scenario "An embedding call reaches the mapped deployment rather than the model id"
def test_an_embedding_call_names_the_deployment_over_the_callers_model(monkeypatch):
    monkeypatch.setenv("AZURE_EMBEDDINGS_DEPLOYMENT_NAME", "prod-embeddings")
    # How the platform sends the embeddings model: as a request setting merged
    # into the call arguments. It used to land after the rewrite and undo it.
    monkeypatch.setenv("X_LITELLM_EMBEDDINGS_model", "azure/text-embedding-ada-002")

    kwargs = patch_litellm_embedding_params({"model": "azure/text-embedding-ada-002"})

    assert kwargs["model"] == "azure/prod-embeddings"


# @scenario "The deployment name is never sent as a call argument"
def test_an_embedding_deployment_argument_does_not_survive_into_the_request():
    kwargs = patch_litellm_embedding_params(
        {"model": "azure/text-embedding-ada-002", "deployment": "prod-embeddings"}
    )

    assert "deployment" not in kwargs
    assert kwargs["model"] == "azure/prod-embeddings"


# @scenario "A deployment name left in the environment does not divert a call to another provider"
def test_an_embedding_deployment_does_not_divert_another_provider(monkeypatch):
    monkeypatch.setenv("AZURE_EMBEDDINGS_DEPLOYMENT_NAME", "prod-embeddings")

    kwargs = patch_litellm_embedding_params({"model": "openai/text-embedding-3-small"})

    assert kwargs["model"] == "openai/text-embedding-3-small"


# @scenario "Credentials follow the model the request ends up naming"
def test_embedding_credentials_follow_the_resolved_model():
    """The credentials belong to the provider the call finally addresses.

    An evaluator carrying a baked-in OpenAI embeddings default is redirected
    to the provider the project configured, and the redirect arrives as
    X_LITELLM_EMBEDDINGS_model. Resolving credentials from the model on the
    way in picks the provider the call no longer addresses.

    The request env here deliberately carries no X_LITELLM_EMBEDDINGS_api_key:
    the platform does send one, and it would mask the ordering. What is under
    test is which provider's table the resolution reads.
    """
    env = {
        "X_LITELLM_EMBEDDINGS_model": "azure/text-embedding-ada-002",
        "AZURE_OPENAI_API_KEY": "azure-key",
        "AZURE_OPENAI_ENDPOINT": "https://example-resource.openai.azure.test",
        "OPENAI_API_KEY": "openai-key",
    }

    with request_env(env):
        kwargs = patch_litellm_embedding_params(
            {"model": "openai/text-embedding-ada-002"}
        )

    assert kwargs["model"] == "azure/text-embedding-ada-002"
    assert kwargs["api_key"] == "azure-key"
    assert kwargs["api_base"] == "https://example-resource.openai.azure.test"


# @scenario "Credentials follow the model the request ends up naming"
def test_completion_credentials_follow_the_resolved_model():
    """The same ordering on the completion path, where X_LITELLM_model can
    equally name a provider the caller's own argument did not."""
    env = {
        "X_LITELLM_model": "azure/gpt-4o",
        "AZURE_OPENAI_API_KEY": "azure-key",
        "AZURE_OPENAI_ENDPOINT": "https://example-resource.openai.azure.test",
        "OPENAI_API_KEY": "openai-key",
    }

    with request_env(env):
        kwargs = patch_litellm_params({"model": "openai/gpt-4o"})

    assert kwargs["model"] == "azure/gpt-4o"
    assert kwargs["api_key"] == "azure-key"
    assert kwargs["api_base"] == "https://example-resource.openai.azure.test"
