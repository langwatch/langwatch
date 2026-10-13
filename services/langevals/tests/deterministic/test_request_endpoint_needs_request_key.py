"""A request that names the endpoint must also name the key sent to it.

The server's own provider credentials are a fallback for requests that carry
none. They must never travel to a destination the request chose, so a request
env that overrides an endpoint without supplying the matching credential is
refused, both on the litellm path and through `get_env`.
"""

import os
import sys

# Same import guard as the other files in this directory.
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

server.original_env = os.environ.copy()

import pytest

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluatorEntry,
    EvaluatorSettings,
    SingleEvaluationResult,
)
from langevals_core.litellm_patch import (
    RequestEndpointWithoutKeyError,
    patch_litellm_embedding_params,
    patch_litellm_params,
)
from langevals_core.request_env import request_env


@pytest.fixture
def server_keys(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "server-openai-key")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "server-aws-id")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "server-aws-secret")


@pytest.mark.parametrize(
    "env",
    [
        {"X_LITELLM_api_base": "https://elsewhere.example.com"},
        {"X_LITELLM_base_url": "https://elsewhere.example.com"},
        {"OPENAI_BASE_URL": "https://elsewhere.example.com"},
    ],
)
def test_an_endpoint_without_a_request_key_is_refused(server_keys, env):
    with request_env(env):
        with pytest.raises(RequestEndpointWithoutKeyError):
            patch_litellm_params({"model": "openai/gpt-5-mini"})


def test_an_embeddings_endpoint_without_a_request_key_is_refused(server_keys):
    with request_env({"X_LITELLM_EMBEDDINGS_api_base": "https://elsewhere.example.com"}):
        with pytest.raises(RequestEndpointWithoutKeyError):
            patch_litellm_embedding_params({"model": "openai/text-embedding-3-small"})


def test_a_bedrock_endpoint_without_request_aws_keys_is_refused(server_keys):
    env = {"X_LITELLM_aws_bedrock_runtime_endpoint": "https://elsewhere.example.com"}
    with request_env(env):
        with pytest.raises(RequestEndpointWithoutKeyError):
            patch_litellm_params({"model": "bedrock/anthropic.claude-v2"})


def test_an_endpoint_with_its_request_key_is_kept(server_keys):
    env = {
        "X_LITELLM_api_base": "https://custom.example.com",
        "X_LITELLM_api_key": "request-key",
    }
    with request_env(env):
        kwargs = patch_litellm_params({"model": "openai/gpt-5-mini"})
    assert kwargs["api_base"] == "https://custom.example.com"
    assert kwargs["api_key"] == "request-key"


def test_a_server_side_endpoint_is_not_the_request_choosing(server_keys, monkeypatch):
    monkeypatch.setenv("X_LITELLM_api_base", "https://operator.example.com")
    with request_env({"X_LITELLM_temperature": "0"}):
        kwargs = patch_litellm_params({"model": "openai/gpt-5-mini"})
    assert kwargs["api_base"] == "https://operator.example.com"


class EndpointEvaluator(BaseEvaluator[EvaluatorEntry, EvaluatorSettings, SingleEvaluationResult]):
    env_vars = ["SOME_SERVICE_ENDPOINT", "SOME_SERVICE_KEY"]


def test_get_env_refuses_the_server_key_for_a_request_endpoint(monkeypatch):
    monkeypatch.setenv("SOME_SERVICE_KEY", "server-service-key")
    evaluator = EndpointEvaluator.model_construct(
        env={"SOME_SERVICE_ENDPOINT": "https://elsewhere.example.com"}
    )
    with pytest.raises(RequestEndpointWithoutKeyError):
        evaluator.get_env("SOME_SERVICE_KEY")


def test_get_env_reads_the_server_key_for_the_server_endpoint(monkeypatch):
    monkeypatch.setenv("SOME_SERVICE_KEY", "server-service-key")
    evaluator = EndpointEvaluator.model_construct(env={})
    assert evaluator.get_env("SOME_SERVICE_KEY") == "server-service-key"
