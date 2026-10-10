"""Credential-free contract tests for Azure evaluator deployment routing."""

import os

import pytest

from langevals_core.litellm_patch import (
    patch_litellm_embedding_params,
    patch_litellm_params,
)
from langevals_core.request_env import request_env


@pytest.fixture(autouse=True)
def scrubbed_azure_deployment_env(monkeypatch):
    """Developer deployment variables must not steer these tests."""
    for key in list(os.environ):
        if key.startswith("X_LITELLM_") or key in {
            "AZURE_DEPLOYMENT_NAME",
            "AZURE_EMBEDDINGS_DEPLOYMENT_NAME",
        }:
            monkeypatch.delenv(key)


def test_completion_uses_request_scoped_azure_deployment():
    with request_env(
        {
            "X_LITELLM_model": "azure/gpt-4o",
            "AZURE_DEPLOYMENT_NAME": "prod-judge",
        }
    ):
        kwargs = patch_litellm_params({"model": "azure/gpt-4o"})

    assert kwargs["model"] == "azure/prod-judge"
    assert "deployment" not in kwargs


def test_embeddings_use_request_scoped_azure_deployment():
    with request_env(
        {
            "X_LITELLM_EMBEDDINGS_model": "azure/text-embedding-3-small",
            "AZURE_EMBEDDINGS_DEPLOYMENT_NAME": "prod-embeddings",
        }
    ):
        kwargs = patch_litellm_embedding_params(
            {"model": "azure/text-embedding-3-small"}
        )

    assert kwargs["model"] == "azure/prod-embeddings"
    assert "deployment" not in kwargs


def test_azure_embeddings_deployment_does_not_rewrite_non_azure_model():
    with request_env(
        {
            "X_LITELLM_EMBEDDINGS_model": "openai/text-embedding-3-small",
            "AZURE_EMBEDDINGS_DEPLOYMENT_NAME": "prod-embeddings",
        }
    ):
        kwargs = patch_litellm_embedding_params(
            {"model": "openai/text-embedding-3-small"}
        )

    assert kwargs["model"] == "openai/text-embedding-3-small"
    assert "deployment" not in kwargs


def test_unmapped_azure_model_keeps_its_model_id():
    with request_env({}):
        completion = patch_litellm_params({"model": "azure/gpt-4o"})
        embeddings = patch_litellm_embedding_params(
            {"model": "azure/text-embedding-3-small"}
        )

    assert completion["model"] == "azure/gpt-4o"
    assert embeddings["model"] == "azure/text-embedding-3-small"
