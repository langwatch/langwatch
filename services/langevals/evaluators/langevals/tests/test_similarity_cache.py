"""The target text of the similarity evaluator is embedded once per process.

The provider is stubbed, so these run offline and count every embedding
request the evaluator makes.
"""

import hashlib
import re
import threading
import time
from pathlib import Path

import litellm
import numpy as np
import pytest
from langevals_core.base_evaluator import DEFAULT_MAX_TOKENS
from langevals_langevals import similarity
from langevals_langevals.similarity import (
    CustomSimilarityEntry,
    CustomSimilarityEvaluator,
    CustomSimilaritySettings,
    PROJECT_SCOPE_ENV,
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
        time.sleep(0.02)  # long enough for parallel misses to overlap
        return FakeEmbeddingResponse(fake_embedding_of(input))

    monkeypatch.setattr(litellm, "embedding", fake_embedding)
    monkeypatch.setattr(
        litellm, "encode", lambda model, text: text.split()  # one token per word
    )
    similarity.target_embedding_cache.clear()
    yield requests
    similarity.target_embedding_cache.clear()


def make_evaluator(value="You suck", env=None, project="project-a", **settings):
    if project is not None:
        env = {**(env or {}), PROJECT_SCOPE_ENV: project}
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

    # The server's default width, so every entry misses the cold cache at once.
    results = make_evaluator(env={"OPENAI_API_KEY": "sk-a"}).evaluate_batch(
        entries, max_evaluations_in_parallel=50
    )

    assert [r.status for r in results] == ["processed"] * 10
    assert [r["input"] for r in embedding_requests].count("You suck") == 1
    assert len(embedding_requests) == 11


# @scenario "Entries waiting on a failed target embedding share its failure"
def test_waiters_share_a_failed_target_embedding(monkeypatch):
    calls: list[str] = []

    def failing_embedding(*, model, input, **kwargs):
        calls.append(input)
        time.sleep(0.2)  # long enough for every entry to wait on this call
        raise RuntimeError("provider timed out")

    monkeypatch.setattr(litellm, "embedding", failing_embedding)
    monkeypatch.setattr(litellm, "encode", lambda model, text: text.split())
    similarity.target_embedding_cache.clear()
    cache = similarity.target_embedding_cache
    key = TargetEmbeddingCache.key("m", {PROJECT_SCOPE_ENV: "p"}, "You suck")
    outcomes: list[str] = []

    def wait_on_target():
        try:
            cache.get_or_compute(
                key, lambda: make_evaluator().embed_target("You suck")
            )
        except RuntimeError as error:
            outcomes.append(str(error))

    threads = [threading.Thread(target=wait_on_target) for _ in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert outcomes == ["provider timed out"] * 10
    assert calls == ["You suck"]
    assert len(cache) == 0


# @scenario "Different credentials embed the target again"
def test_different_credentials_embed_the_target_again(embedding_requests):
    entry = CustomSimilarityEntry(output="an answer")

    make_evaluator(env={"OPENAI_API_KEY": "sk-project-a"}).evaluate_batch([entry])
    make_evaluator(env={"OPENAI_API_KEY": "sk-project-b"}).evaluate_batch([entry])

    assert [r["input"] for r in embedding_requests].count("You suck") == 2


# @scenario "Projects on the install's own credentials never share a target"
def test_projects_on_install_credentials_never_share_a_target(embedding_requests):
    entry = CustomSimilarityEntry(output="an answer")
    install = {"OPENAI_API_KEY": "sk-install"}

    make_evaluator(env=install, project="project-a").evaluate_batch([entry])
    make_evaluator(env=install, project="project-b").evaluate_batch([entry])
    make_evaluator(env=install, project="project-b").evaluate_batch([entry])

    assert [r["input"] for r in embedding_requests].count("You suck") == 2


# @scenario "A request that names no project is not cached"
def test_request_without_a_project_is_not_cached(embedding_requests):
    entry = CustomSimilarityEntry(output="an answer")

    make_evaluator(project=None).evaluate(entry)
    make_evaluator(project=None).evaluate(entry)

    assert [r["input"] for r in embedding_requests].count("You suck") == 2
    assert len(similarity.target_embedding_cache) == 0


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
    a, b, c = (
        TargetEmbeddingCache.key("m", {PROJECT_SCOPE_ENV: "p"}, text) for text in "abc"
    )

    cache.put(a, np.zeros(1))
    cache.put(b, np.zeros(1))
    cache.get(a)
    cache.put(c, np.zeros(1))

    assert len(cache) == 2
    assert cache.get(b) is None
    assert cache.get(a) is not None
    assert cache.get(c) is not None


APP_SIDE = Path("modules/evaluation/process/src/features/execution/services/evaluation-execution.service.ts")


def test_the_project_env_var_is_the_one_the_app_sets():
    """The app names the variable in TypeScript; a rename on either side must fail here."""
    marker = Path("modules/catalogue.json")
    root = next((p for p in Path(__file__).resolve().parents if (p / marker).is_file()), None)
    if root is None:
        pytest.skip("not run from a LangWatch checkout")
    assert (root / APP_SIDE).is_file(), f"{APP_SIDE} moved: point this check at its new path"
    source = (root / APP_SIDE).read_text()
    match = re.search(r'export const EVALUATION_PROJECT_ENV = "([A-Z_]+)";', source)
    assert match, f"EVALUATION_PROJECT_ENV is no longer declared in {APP_SIDE}"
    assert match.group(1) == PROJECT_SCOPE_ENV
