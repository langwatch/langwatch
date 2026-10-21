"""Clustering hands back the embeddings it computed, when the caller asks.

Spec: modules/trace/specs/similar-traces.feature
"""

import base64
import json

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import langevals_topic_clustering.batch_clustering as batch_clustering
import langevals_topic_clustering.incremental_clustering as incremental_clustering

VECTORS = {
    "trace_1": [0.25, -0.5, 1.0],
    "trace_2": [0.125, 0.75, -2.0],
}

# Each vector scaled so its largest component is 127, rounded half to even.
QUANTIZED = {
    "trace_1": [32, -64, 127],
    "trace_2": [8, 48, -127],
}

COST = {"amount": 0.0, "currency": "USD"}


def embedded(traces, _params):
    return [
        {**trace, "embeddings": VECTORS[trace["trace_id"]]}
        for trace in traces
        if trace["trace_id"] in VECTORS
    ]


def decode(embedding):
    return np.frombuffer(base64.b64decode(embedding), dtype=np.int8).tolist()


def body(return_trace_embeddings=None, **extra):
    request = {
        "project_id": "project_1",
        "traces": [
            {"trace_id": trace_id, "input": trace_id, "topic_id": None, "subtopic_id": None}
            for trace_id in VECTORS
        ],
        "litellm_params": {"model": "openai/gpt-5-mini"},
        "embeddings_litellm_params": {"model": "openai/text-embedding-3-small"},
        **extra,
    }
    if return_trace_embeddings is not None:
        request["return_trace_embeddings"] = return_trace_embeddings
    return request


@pytest.fixture
def batch_client(monkeypatch):
    monkeypatch.setattr(batch_clustering, "fill_embeddings", embedded)
    monkeypatch.setattr(batch_clustering, "build_hierarchy", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        batch_clustering,
        "generate_topic_and_subtopic_names",
        lambda **_kwargs: ([], [], COST),
    )
    app = FastAPI()
    batch_clustering.setup_endpoints(app)
    return TestClient(app)


@pytest.fixture
def incremental_client(monkeypatch):
    monkeypatch.setattr(incremental_clustering, "fill_embeddings", embedded)
    monkeypatch.setattr(
        incremental_clustering,
        "maybe_create_new_topics_and_subtopics_from_unassigned_traces",
        lambda **_kwargs: ([], [], [], COST),
    )
    app = FastAPI()
    incremental_clustering.setup_endpoints(app)
    return TestClient(app)


# @scenario "Clustering hands back the embeddings it computed when asked"
def test_batch_clustering_returns_every_embedded_trace_when_asked(batch_client):
    response = batch_client.post("/topics/batch_clustering", json=body(True))

    assert response.status_code == 200
    returned = {item["trace_id"]: decode(item["embedding"]) for item in response.json()["trace_embeddings"]}
    assert returned == QUANTIZED
    assert response.json()["trace_embeddings_omitted"] == 0


# @scenario "Clustering hands back the embeddings it computed when asked"
def test_incremental_clustering_returns_every_embedded_trace_when_asked(incremental_client):
    response = incremental_client.post(
        "/topics/incremental_clustering", json=body(True, topics=[], subtopics=[])
    )

    assert response.status_code == 200
    returned = {item["trace_id"]: decode(item["embedding"]) for item in response.json()["trace_embeddings"]}
    assert returned == QUANTIZED
    assert response.json()["trace_embeddings_omitted"] == 0


# @scenario "A caller that does not ask for embeddings gets the response it always had"
def test_batch_clustering_leaves_embeddings_out_unless_asked(batch_client):
    response = batch_client.post("/topics/batch_clustering", json=body())

    assert response.status_code == 200
    assert "trace_embeddings" not in response.json()


# @scenario "A caller that does not ask for embeddings gets the response it always had"
def test_incremental_clustering_leaves_embeddings_out_unless_asked(incremental_client):
    response = incremental_client.post(
        "/topics/incremental_clustering", json=body(False, topics=[], subtopics=[])
    )

    assert response.status_code == 200
    assert "trace_embeddings" not in response.json()


# @scenario "Clustering keeps its response under the deployment's ceiling"
def test_batch_clustering_leaves_out_embeddings_past_the_response_ceiling(batch_client):
    unbounded = batch_client.post("/topics/batch_clustering", json=body(True)).json()
    without_embeddings = {
        key: value
        for key, value in unbounded.items()
        if key not in ("trace_embeddings", "trace_embeddings_omitted")
    }
    ceiling = len(json.dumps(without_embeddings)) + 64 + 60

    response = batch_client.post(
        "/topics/batch_clustering", json=body(True, max_response_bytes=ceiling)
    )

    assert response.status_code == 200
    assert [item["trace_id"] for item in response.json()["trace_embeddings"]] == ["trace_1"]
    assert response.json()["trace_embeddings_omitted"] == 1
