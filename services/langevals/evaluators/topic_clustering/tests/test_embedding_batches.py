"""Embedding a page requests its batches concurrently, in order, retries a rate
limit in place, and stops at an auth refusal.

Spec: specs/nlp-go/topic-clustering.feature
"""

import threading
import time
from types import SimpleNamespace

import litellm
import pytest
from tenacity import wait_none

import langevals_topic_clustering.utils as utils
from langevals_core.usage_ledger import collect_usage, record_usage

PROVIDER = {"llm_provider": "openai", "model": "text-embedding-3-small"}
PARAMS = {"model": "openai/text-embedding-3-small", "dimensions": 1}
TEXTS = [f"text-{i}" for i in range(200)]
EXPECTED = [[float(i)] for i in range(200)]


@pytest.fixture(autouse=True)
def no_retry_wait(monkeypatch):
    monkeypatch.setattr(utils._embed_batch.retry, "wait", wait_none())


def answer(input):
    """One-number embeddings naming each text, recorded the way the litellm patch records them."""
    texts = input if isinstance(input, list) else [input]
    response = SimpleNamespace(
        data=[{"embedding": [float(text.split("-")[1])]} for text in texts],
        usage=SimpleNamespace(prompt_tokens=len(texts)),
    )
    record_usage(PARAMS["model"], response)
    return response


class FakeProvider:
    """Answers slowly enough for batches to overlap, and counts how many do."""

    def __init__(self):
        self.lock = threading.Lock()
        self.in_flight = 0
        self.most_in_flight = 0
        self.calls = 0

    def embedding(self, *, input, **_params):
        with self.lock:
            self.calls += 1
            self.in_flight += 1
            self.most_in_flight = max(self.most_in_flight, self.in_flight)
        time.sleep(0.05)
        with self.lock:
            self.in_flight -= 1
        return answer(input)


# @scenario "Embedding batches for one page are requested concurrently"
def test_batches_overlap_up_to_the_bound_and_keep_their_order(monkeypatch):
    provider = FakeProvider()
    monkeypatch.setattr(litellm, "embedding", provider.embedding)

    with collect_usage() as usage:
        embeddings = utils.generate_embeddings(TEXTS, PARAMS, max_workers=4)

    assert provider.calls == 10
    assert 1 < provider.most_in_flight <= 4
    assert embeddings == EXPECTED
    [model_usage] = usage.models()
    assert (model_usage.calls, model_usage.input_tokens) == (10, 200)


# @scenario "A rate-limited embedding batch is retried in place"
def test_a_rate_limited_batch_is_asked_again(monkeypatch):
    refused = []

    def limit_once(*, input, **_params):
        if not isinstance(input, list):
            pytest.fail("fell back to one call per input")
        if input[0] == "text-40" and not refused:
            refused.append(input[0])
            raise litellm.exceptions.RateLimitError(message="slow down", **PROVIDER)
        return answer(input)

    monkeypatch.setattr(litellm, "embedding", limit_once)

    assert utils.generate_embeddings(TEXTS, PARAMS) == EXPECTED
    assert refused == ["text-40"]


# @scenario "A batch still rate limited after its retries is raised to the caller"
def test_a_batch_rate_limited_on_every_try_is_raised(monkeypatch):
    single_calls = []

    def always_limit(*, input, **_params):
        if not isinstance(input, list):
            single_calls.append(input)
        raise litellm.exceptions.RateLimitError(message="slow down", **PROVIDER)

    monkeypatch.setattr(litellm, "embedding", always_limit)

    with pytest.raises(litellm.exceptions.RateLimitError):
        utils.generate_embeddings(TEXTS[:40], PARAMS)

    assert single_calls == []


# @scenario "A batch still rate limited after its retries is raised to the caller"
def test_a_later_batch_rate_limit_is_raised_when_an_earlier_batch_failed(monkeypatch):
    second_batch_started = threading.Event()
    single_calls = []

    def fail_then_limit(*, input, **_params):
        if not isinstance(input, list):
            single_calls.append(input)
            return answer(input)
        if input[0] == "text-0":
            assert second_batch_started.wait(timeout=5)
            raise litellm.exceptions.APIConnectionError(message="reset", **PROVIDER)
        second_batch_started.set()
        raise litellm.exceptions.RateLimitError(message="slow down", **PROVIDER)

    monkeypatch.setattr(litellm, "embedding", fail_then_limit)

    with pytest.raises(litellm.exceptions.RateLimitError):
        utils.generate_embeddings(TEXTS[:40], PARAMS, max_workers=2)

    assert single_calls == []


# @scenario "Any other failed embedding batch falls back to one call per input"
def test_any_other_batch_failure_falls_back_after_the_batches_in_flight(monkeypatch):
    lock = threading.Lock()
    all_batches_started = threading.Barrier(3, timeout=5)
    last_batch_returned = []
    single_calls_started = []

    def first_batch_fails(*, input, **_params):
        if not isinstance(input, list):
            with lock:
                single_calls_started.append(time.monotonic())
            return answer(input)
        all_batches_started.wait()
        if input[0] == "text-0":
            raise litellm.exceptions.APIConnectionError(message="reset", **PROVIDER)
        time.sleep(0.2)
        with lock:
            last_batch_returned.append(time.monotonic())
        return answer(input)

    monkeypatch.setattr(litellm, "embedding", first_batch_fails)

    assert utils.generate_embeddings(TEXTS[:60], PARAMS, max_workers=3) == EXPECTED[:60]
    assert len(last_batch_returned) == 2
    assert len(single_calls_started) == 60
    assert min(single_calls_started) >= max(last_batch_returned)


# @scenario "Embedding a page stops at a provider auth refusal without retrying input by input"
def test_an_auth_refusal_is_raised_without_a_per_input_fallback(monkeypatch):
    single_calls = []

    def refuse(*, input, **_params):
        if not isinstance(input, list):
            single_calls.append(input)
        raise litellm.exceptions.AuthenticationError(message="bad key", **PROVIDER)

    monkeypatch.setattr(litellm, "embedding", refuse)

    with pytest.raises(litellm.exceptions.AuthenticationError):
        utils.generate_embeddings(TEXTS[:100], PARAMS)

    assert single_calls == []
