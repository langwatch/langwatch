"""A missing provider key is the customer's to fix, and only when a call needs it.

These run litellm's own credential lookup: no key is pre-checked, so a key it
finds under any name, in the request or in cloud credentials, is used.

Spec: specs/nlp-go/topic-clustering.feature
"""

import json
import os
import zlib
from types import SimpleNamespace

import litellm
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import langevals_topic_clustering.batch_clustering as batch_clustering
import langevals_topic_clustering.incremental_clustering as incremental_clustering
import langevals_topic_clustering.utils as utils
from langevals_topic_clustering.refusals import is_missing_key

PROVIDER_KEYS = [
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "AZURE_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AZURE_API_BASE",
    "AZURE_OPENAI_ENDPOINT",
]
DIMENSIONS = 1536
OPENAI_LLM = {"model": "openai/gpt-4.1-mini"}
OPENAI_EMBEDDINGS = {"model": "openai/text-embedding-3-small"}


@pytest.fixture(autouse=True)
def no_provider_keys(monkeypatch, tmp_path):
    """No provider keys, no AWS credentials anywhere boto looks, no instance metadata."""
    for key in PROVIDER_KEYS:
        monkeypatch.delenv(key, raising=False)
    for key in [name for name in os.environ if name.startswith("AWS_")]:
        monkeypatch.delenv(key)
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "aws-config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "aws-credentials"))


@pytest.fixture
def client():
    app = FastAPI()
    batch_clustering.setup_endpoints(app)
    incremental_clustering.setup_endpoints(app)
    return TestClient(app)


def vector(text):
    """A unit vector per text, so different texts are as far apart as they get."""
    values = [0.0] * DIMENSIONS
    values[zlib.crc32(text.encode()) % DIMENSIONS] = 1.0
    return values


class FakeProvider:
    """Answers litellm's embedding and naming calls, recording what each was sent."""

    def __init__(self):
        self.embedding_calls: list[dict] = []
        self.completion_calls: list[dict] = []

    def embedding(self, **kwargs):
        self.embedding_calls.append(kwargs)
        inputs = kwargs["input"] if isinstance(kwargs["input"], list) else [kwargs["input"]]
        return SimpleNamespace(
            data=[{"embedding": vector(text)} for text in inputs],
            usage=SimpleNamespace(prompt_tokens=1),
        )

    def completion(self, **kwargs):
        self.completion_calls.append(kwargs)
        fields = kwargs["tools"][0]["function"]["parameters"]["properties"]
        names = {field: f"Name {len(self.completion_calls)} {field}" for field in fields}
        call = SimpleNamespace(function=SimpleNamespace(arguments=json.dumps(names)))
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[call]))])


@pytest.fixture
def provider(monkeypatch):
    fake = FakeProvider()
    monkeypatch.setattr(litellm, "embedding", fake.embedding)
    monkeypatch.setattr(litellm, "completion", fake.completion)
    return fake


@pytest.fixture
def embeddings_only(monkeypatch):
    """Embeddings answer; a naming call fails the test."""
    fake = FakeProvider()
    monkeypatch.setattr(litellm, "embedding", fake.embedding)

    def no_naming(**_kwargs):
        raise AssertionError("a naming call was made")

    monkeypatch.setattr(litellm, "completion", no_naming)
    return fake


def trace(trace_id, text):
    return {"trace_id": trace_id, "input": text, "topic_id": None, "subtopic_id": None}


def incremental_body_matching_one_topic(litellm_params, embeddings_litellm_params):
    """One trace whose embedding sits on an existing topic's centroid."""
    return {
        "project_id": "project_1",
        "topics": [{"id": "topic_1", "name": "Billing", "centroid": vector("refund"), "p95_distance": 0.1}],
        "subtopics": [],
        "traces": [trace("trace_1", "refund")],
        "litellm_params": litellm_params,
        "embeddings_litellm_params": embeddings_litellm_params,
    }


def batch_body(litellm_params, embeddings_litellm_params, traces=None):
    return {
        "project_id": "project_1",
        "traces": traces or [trace("trace_1", "hello"), trace("trace_2", "goodbye")],
        "litellm_params": litellm_params,
        "embeddings_litellm_params": embeddings_litellm_params,
    }


def one_topic_hierarchy(*_args, **_kwargs):
    samples = [
        {"trace_id": f"trace_{i}", "input": f"question {i}", "embeddings": vector(f"question {i}")}
        for i in range(6)
    ]
    return {"Topic 1": {"Subtopic 1": samples}}


def counted(monkeypatch, name):
    """Counts the real litellm calls to `name`, which still run."""
    calls = []
    real = getattr(litellm, name)

    def call(**kwargs):
        calls.append(kwargs)
        return real(**kwargs)

    monkeypatch.setattr(litellm, name, call)
    return calls


# @scenario "A model provider with no API key is answered as the customer's to fix"
@pytest.mark.parametrize(
    "embeddings_litellm_params",
    [
        OPENAI_EMBEDDINGS,
        {"model": "gemini/text-embedding-004"},
        {"model": "bedrock/amazon.titan-embed-text-v2:0", "aws_region_name": "eu-central-1"},
    ],
)
@pytest.mark.parametrize("endpoint", ["batch", "incremental"])
def test_an_embeddings_model_with_no_key_is_a_typed_4xx(
    client, monkeypatch, endpoint, embeddings_litellm_params
):
    calls = counted(monkeypatch, "embedding")
    llm = {**OPENAI_LLM, "api_key": "sk-request"}
    if endpoint == "batch":
        response = client.post("/topics/batch_clustering", json=batch_body(llm, embeddings_litellm_params))
    else:
        body = incremental_body_matching_one_topic(llm, embeddings_litellm_params)
        response = client.post("/topics/incremental_clustering", json=body)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "model_provider_key_missing"
    assert len(calls) == 1


# @scenario "A model provider with no API key is answered as the customer's to fix"
@pytest.mark.parametrize(
    "litellm_params",
    [
        OPENAI_LLM,
        {"model": "bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0", "aws_region_name": "eu-central-1"},
        {"model": "bedrock/anthropic.claude-3-5-sonnet-20240620-v1:0"},
    ],
)
def test_a_naming_model_with_no_key_is_a_typed_4xx(client, monkeypatch, litellm_params):
    monkeypatch.setattr(litellm, "embedding", FakeProvider().embedding)
    monkeypatch.setattr(batch_clustering, "build_hierarchy", one_topic_hierarchy)
    calls = counted(monkeypatch, "completion")

    response = client.post("/topics/batch_clustering", json=batch_body(litellm_params, OPENAI_EMBEDDINGS))

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "model_provider_key_missing"
    # One topic and one subtopic group to name, each tried once.
    assert len(calls) <= 2


# @scenario "A run that names no topic needs no key for the naming model"
def test_traces_that_all_match_existing_topics_need_no_naming_key(client, embeddings_only):
    body = incremental_body_matching_one_topic(OPENAI_LLM, OPENAI_EMBEDDINGS)

    response = client.post("/topics/incremental_clustering", json=body)

    assert response.status_code == 200
    assert response.json()["traces"] == [{"trace_id": "trace_1", "topic_id": "topic_1", "subtopic_id": None}]
    assert response.json()["topics"] == []


# @scenario "A run that names no topic needs no key for the naming model"
def test_a_batch_that_finds_no_topic_needs_no_naming_key(client, embeddings_only):
    response = client.post("/topics/batch_clustering", json=batch_body(OPENAI_LLM, OPENAI_EMBEDDINGS))

    assert response.status_code == 200
    assert response.json()["topics"] == []
    assert len(embeddings_only.embedding_calls) > 0


CREDENTIALS_IN_THE_REQUEST = [
    {"model": "openai/text-embedding-3-small", "api_key": "sk-request"},
    {"model": "openai/text-embedding-3-small", "api_base": "http://localhost:4000"},
    {
        "model": "bedrock/amazon.titan-embed-text-v2:0",
        "aws_access_key_id": "AKIA-request",
        "aws_secret_access_key": "secret-request",
        "aws_region_name": "eu-central-1",
    },
    {
        "model": "vertex_ai/text-embedding-005",
        "vertex_project": "project-request",
        "vertex_location": "europe-west4",
        "vertex_credentials": "{}",
    },
]


# @scenario "A key that arrives in the request is used, never refused"
@pytest.mark.parametrize("embeddings_litellm_params", CREDENTIALS_IN_THE_REQUEST)
def test_embeddings_credentials_in_the_request_are_used(client, embeddings_only, embeddings_litellm_params):
    body = incremental_body_matching_one_topic(OPENAI_LLM, embeddings_litellm_params)

    response = client.post("/topics/incremental_clustering", json=body)

    assert response.status_code == 200
    sent = embeddings_only.embedding_calls[0]
    for name, value in embeddings_litellm_params.items():
        assert sent[name] == value


# @scenario "A key that arrives in the request is used, never refused"
@pytest.mark.parametrize(
    "litellm_params",
    [
        {**OPENAI_LLM, "api_key": "sk-request"},
        {
            "model": "bedrock/anthropic.claude-sonnet-4-5",
            "aws_access_key_id": "AKIA-request",
            "aws_secret_access_key": "secret-request",
            "aws_region_name": "eu-central-1",
        },
        {
            "model": "vertex_ai/gemini-2.5-flash",
            "vertex_project": "project-request",
            "vertex_location": "europe-west4",
            "vertex_credentials": "{}",
        },
    ],
)
def test_naming_credentials_in_the_request_are_used(client, monkeypatch, provider, litellm_params):
    monkeypatch.setattr(batch_clustering, "build_hierarchy", one_topic_hierarchy)
    embeddings = {"model": "openai/text-embedding-3-small", "api_key": "sk-request"}

    response = client.post("/topics/batch_clustering", json=batch_body(litellm_params, embeddings))

    assert response.status_code == 200
    assert [topic["name"] for topic in response.json()["topics"]]
    for sent in provider.completion_calls:
        for name, value in litellm_params.items():
            assert sent[name] == value


# @scenario "A model provider with no API key is answered as the customer's to fix"
@pytest.mark.parametrize("path", ["singleton batches", "per-input fallback"])
def test_a_missing_key_is_raised_from_every_embedding_path(monkeypatch, path):
    calls = counted(monkeypatch, "embedding")
    texts = [f"text {i}" for i in range(30)]

    with pytest.raises(Exception) as raised:
        if path == "singleton batches":
            utils.generate_embeddings(texts, OPENAI_EMBEDDINGS, batch_size=1, max_workers=1)
        else:
            utils.generate_embeddings_threaded(texts, OPENAI_EMBEDDINGS, max_workers=1)

    assert is_missing_key(raised.value)
    # The one worker may start the next input before the refusal is read; no more.
    assert len(calls) <= 2
