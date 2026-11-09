"""A clustering request returns the provider usage of its embedding and naming
calls, summed per model, so the platform can write it to the spend ledger.

Spec: modules/gateway/specs/gateway-platform-provider-usage.feature
"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import langevals_topic_clustering.batch_clustering as batch_clustering
from langevals_core.usage_ledger import record_usage


@pytest.fixture
def client():
    app = FastAPI()
    batch_clustering.setup_endpoints(app)
    return TestClient(app)


BODY = {
    "project_id": "project_1",
    "traces": [{"trace_id": "trace_1", "input": "hello", "topic_id": None, "subtopic_id": None}],
    "litellm_params": {"model": "openai/gpt-5-mini"},
    "embeddings_litellm_params": {"model": "openai/text-embedding-3-large"},
}


def embedding_answer(tokens):
    return SimpleNamespace(usage=SimpleNamespace(prompt_tokens=tokens))


# @scenario "A topic clustering run reports the provider usage of its embeddings"
def test_the_response_carries_the_embedding_usage(client, monkeypatch):
    def fill_embeddings(traces, _params):
        for _ in traces:
            record_usage("openai/text-embedding-3-large", embedding_answer(1_500))
        return []

    monkeypatch.setattr(batch_clustering, "fill_embeddings", fill_embeddings)
    monkeypatch.setattr(batch_clustering, "build_hierarchy", lambda *_: {})
    monkeypatch.setattr(
        batch_clustering,
        "generate_topic_and_subtopic_names",
        lambda **_: ({}, {}, {"amount": 0, "currency": "USD"}),
    )
    monkeypatch.setattr(batch_clustering, "build_response", lambda *_: ([], [], []))

    response = client.post("/topics/batch_clustering", json=BODY)

    assert response.status_code == 200
    assert response.json()["usage"] == [
        {
            "model": "openai/text-embedding-3-large",
            "calls": 1,
            "input_tokens": 1_500,
            "output_tokens": 0,
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
            "reasoning_tokens": 0,
        }
    ]
