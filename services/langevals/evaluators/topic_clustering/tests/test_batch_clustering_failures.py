"""Batch clustering answers a failure the customer fixes with a typed 4xx.

Spec: specs/nlp-go/topic-clustering.feature
"""

import litellm
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import langevals_topic_clustering.batch_clustering as batch_clustering


@pytest.fixture
def client():
    app = FastAPI()
    batch_clustering.setup_endpoints(app)
    return TestClient(app)


def request_body(litellm_params=None):
    return {
        "project_id": "project_1",
        "traces": [{"trace_id": "trace_1", "input": "hello", "topic_id": None, "subtopic_id": None}],
        "litellm_params": {"model": "openai/gpt-5-mini"} if litellm_params is None else litellm_params,
        "embeddings_litellm_params": {"model": "openai/text-embedding-3-small"},
    }


def failing_embeddings(error):
    def fill_embeddings(*_args, **_kwargs):
        raise error

    return fill_embeddings


PROVIDER = {"llm_provider": "openai", "model": "gpt-5-mini"}


# @scenario "A model provider refusal is answered as the customer's to fix"
@pytest.mark.parametrize(
    "error,status,code",
    [
        (litellm.exceptions.AuthenticationError(message="Incorrect API key provided: sk-abc", **PROVIDER), 422, "model_provider_auth_failed"),
        (litellm.exceptions.RateLimitError(message="quota", **PROVIDER), 429, "model_provider_rate_limited"),
        (litellm.exceptions.BadRequestError(message="bad", **PROVIDER), 422, "model_provider_bad_request"),
    ],
)
def test_a_provider_refusal_is_a_typed_4xx(client, monkeypatch, error, status, code):
    monkeypatch.setattr(batch_clustering, "fill_embeddings", failing_embeddings(error))

    response = client.post("/topics/batch_clustering", json=request_body())

    assert response.status_code == status
    assert response.json()["detail"]["code"] == code
    assert "sk-abc" not in response.text


# @scenario "A model provider refusal is answered as the customer's to fix"
def test_a_missing_model_is_a_typed_4xx(client):
    response = client.post("/topics/batch_clustering", json=request_body(litellm_params={}))

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "model_not_configured"


# @scenario "A model provider with no API key is answered as the customer's to fix"
@pytest.mark.parametrize(
    "litellm_params,embeddings_litellm_params",
    [
        ({"model": "openai/gpt-5-mini"}, {"model": "openai/text-embedding-3-small"}),
        ({"model": "openai/gpt-5-mini", "api_key": "sk-a"}, {"model": "gemini/text-embedding-004"}),
    ],
)
def test_a_missing_api_key_is_a_typed_4xx(
    client, monkeypatch, litellm_params, embeddings_litellm_params
):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(
        batch_clustering, "fill_embeddings", failing_embeddings(AssertionError("embedded"))
    )
    body = request_body(litellm_params=litellm_params)
    body["embeddings_litellm_params"] = embeddings_litellm_params

    response = client.post("/topics/batch_clustering", json=body)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "model_provider_auth_failed"


# @scenario "A model provider with no API key is answered as the customer's to fix"
@pytest.mark.parametrize(
    "embeddings_litellm_params",
    [
        {"model": "openai/text-embedding-3-small", "api_key": "sk-a"},
        {"model": "openai/text-embedding-3-small", "api_base": "http://localhost:4000"},
        {"model": "bedrock/amazon.titan-embed-text-v2:0", "aws_region_name": "eu-central-1"},
    ],
)
def test_a_provider_with_a_key_endpoint_or_cloud_credentials_runs(
    client, monkeypatch, embeddings_litellm_params
):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(batch_clustering, "fill_embeddings", failing_embeddings(RuntimeError("boom")))
    body = request_body(litellm_params={"model": "openai/gpt-5-mini", "api_key": "sk-a"})
    body["embeddings_litellm_params"] = embeddings_litellm_params

    response = client.post("/topics/batch_clustering", json=body)

    assert response.status_code == 500


# @scenario "A failure of ours is still answered as a server error"
def test_any_other_failure_stays_a_500(client, monkeypatch):
    monkeypatch.setattr(batch_clustering, "fill_embeddings", failing_embeddings(RuntimeError("boom")))

    response = client.post("/topics/batch_clustering", json=request_body())

    assert response.status_code == 500
    assert response.json()["detail"] == "Batch clustering failed"
