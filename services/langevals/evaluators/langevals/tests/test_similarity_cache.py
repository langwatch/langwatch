"""The target text of the similarity evaluator is embedded once per process.

The provider is stubbed, so these run offline and count every embedding
request the evaluator makes.
"""

import hashlib

import litellm
import numpy as np
import pytest
from langevals_core.base_evaluator import DEFAULT_MAX_TOKENS
from langevals_langevals import similarity
from langevals_langevals.similarity import (
    CustomSimilarityEntry,
    CustomSimilarityEvaluator,
    CustomSimilaritySettings,
    TargetEmbeddingCache,
)


def fake_embedding_of(text: str) -> list[float]:
    seed = int.from_bytes(hashlib.sha256(text.encode()).digest()[:4], "big")
    return np.random.default_rng(seed).standard_normal(64).tolist()


class FakeEmbeddingResponse:
    def __init__(self, embedding: list[float]):
        self.data = [{"embedding": embedding}]


@pytest.fixture
def embedding_requests(monkeypatch):
    requests: list[dict] = []

    def fake_embedding(*, model, input, **kwargs):
        requests.append({"model": model, "input": input})
        return FakeEmbeddingResponse(fake_embedding_of(input))

    monkeypatch.setattr(litellm, "embedding", fake_embedding)
    monkeypatch.setattr(
        litellm, "encode", lambda model, text: text.split()  # one token per word
    )
    similarity.target_embedding_cache.clear()
    yield requests
    similarity.target_embedding_cache.clear()


def make_evaluator(value="You suck", env=None, **settings):
    return CustomSimilarityEvaluator(
        settings=CustomSimilaritySettings(
            field="output",
            rule="is_not_similar_to",
            value=value,
            threshold=0.3,
            **settings,
        ),
        env=env,
    )


def uncached_score(target: str, content: str) -> float:
    a, b = fake_embedding_of(target), fake_embedding_of(content)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


# @scenario "The second call with the same target makes one embedding request"
def test_second_call_with_same_target_makes_one_embedding_request(
    embedding_requests,
):
    make_evaluator().evaluate(CustomSimilarityEntry(output="first answer"))
    assert len(embedding_requests) == 2

    make_evaluator().evaluate(CustomSimilarityEntry(output="second answer"))

    assert len(embedding_requests) == 3
    assert embedding_requests[2]["input"] == "second answer"


# @scenario "Scores match embedding both texts every time"
def test_scores_are_identical_to_embedding_both_texts(embedding_requests):
    first = make_evaluator().evaluate(CustomSimilarityEntry(output="first answer"))
    second = make_evaluator().evaluate(CustomSimilarityEntry(output="second answer"))

    assert first.score == uncached_score("You suck", "first answer")
    assert second.score == uncached_score("You suck", "second answer")
    assert second.details == (
        f'Cosine similarity of {second.score:.2f} between output and "You suck"'
        ' (threshold: < 0.3)"'
    )


# @scenario "A batch of entries embeds the target once"
def test_batch_of_entries_embeds_the_target_once(embedding_requests):
    entries = [CustomSimilarityEntry(output=f"answer {i}") for i in range(10)]

    results = make_evaluator(env={"OPENAI_API_KEY": "sk-a"}).evaluate_batch(
        entries, max_evaluations_in_parallel=1
    )

    assert [r.status for r in results] == ["processed"] * 10
    assert [r["input"] for r in embedding_requests].count("You suck") == 1
    assert len(embedding_requests) == 11


# @scenario "Different credentials embed the target again"
def test_different_credentials_embed_the_target_again(embedding_requests):
    entry = CustomSimilarityEntry(output="an answer")

    make_evaluator(env={"OPENAI_API_KEY": "sk-project-a"}).evaluate_batch([entry])
    make_evaluator(env={"OPENAI_API_KEY": "sk-project-b"}).evaluate_batch([entry])

    assert [r["input"] for r in embedding_requests].count("You suck") == 2


# @scenario "A different embeddings model embeds the target again"
def test_different_model_embeds_the_target_again(embedding_requests):
    entry = CustomSimilarityEntry(output="an answer")

    make_evaluator().evaluate(entry)
    make_evaluator(embeddings_model="openai/text-embedding-3-large").evaluate(entry)

    target_requests = [r for r in embedding_requests if r["input"] == "You suck"]
    assert [r["model"] for r in target_requests] == [
        "openai/text-embedding-3-small",
        "openai/text-embedding-3-large",
    ]


# @scenario "Entry content is never cached"
def test_entry_content_is_not_cached(embedding_requests):
    entry = CustomSimilarityEntry(output="the same answer")

    make_evaluator().evaluate(entry)
    make_evaluator().evaluate(entry)

    assert [r["input"] for r in embedding_requests].count("the same answer") == 2


# @scenario "The cache keeps digests, not text or credentials"
def test_cache_keeps_digests_not_text_or_credentials(embedding_requests):
    make_evaluator(env={"OPENAI_API_KEY": "sk-secret"}).evaluate_batch(
        [CustomSimilarityEntry(output="an answer")]
    )

    (key,) = similarity.target_embedding_cache._entries.keys()
    assert "You suck" not in repr(key)
    assert "sk-secret" not in repr(key)


# @scenario "A target over the token limit is skipped and not cached"
def test_target_over_the_token_limit_is_skipped_and_not_cached(embedding_requests):
    too_long = "word " * (DEFAULT_MAX_TOKENS + 1)

    result = make_evaluator(value=too_long).evaluate(
        CustomSimilarityEntry(output="an answer")
    )

    assert result.status == "skipped"
    assert embedding_requests == []
    assert len(similarity.target_embedding_cache) == 0


# @scenario "The cache is bounded and drops the least recently used entry"
def test_cache_is_bounded_and_drops_the_least_recently_used():
    cache = TargetEmbeddingCache(max_entries=2)
    a, b, c = (TargetEmbeddingCache.key("m", {}, text) for text in "abc")

    cache.put(a, np.zeros(1))
    cache.put(b, np.zeros(1))
    cache.get(a)
    cache.put(c, np.zeros(1))

    assert len(cache) == 2
    assert cache.get(b) is None
    assert cache.get(a) is not None
    assert cache.get(c) is not None
