import hashlib
import json
import threading
from collections import OrderedDict
from typing import Literal, Optional
from langevals_core.base_evaluator import (
    DEFAULT_MAX_TOKENS,
    BaseEvaluator,
    EvaluatorEntry,
    EvaluationResult,
    EvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResultSkipped,
)
from langevals_core.request_env import current_request_env
from pydantic import Field
import litellm
import numpy as np


class TargetEmbeddingCache:
    """Embeddings of the fixed target text from the settings, kept in memory.

    The server builds a new evaluator for every request and the app sends one
    entry per request, so the target text would be embedded again on every
    call. This cache lives for the whole process instead.

    An entry is looked up by the embeddings model, a digest of the request env
    (the credentials and endpoint the call goes out with) and a digest of the
    text. Two projects only ever share an entry when they send the exact same
    credentials and endpoint, so a project never gets a vector computed with
    someone else's key. Only digests are kept, never the text or the keys, and
    nothing is written outside the process. The entry content of a trace is
    never cached, only the target text from the settings.
    """

    def __init__(self, max_entries: int = 256):
        self.max_entries = max_entries
        self._entries: OrderedDict[tuple[str, str, str], np.ndarray] = OrderedDict()
        self._lock = threading.Lock()
        self._in_flight: dict[tuple[str, str, str], threading.Lock] = {}

    @staticmethod
    def key(model: str, env: dict[str, str], text: str) -> tuple[str, str, str]:
        env_digest = hashlib.sha256(
            json.dumps(env, sort_keys=True).encode("utf-8")
        ).hexdigest()
        text_digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return (model, env_digest, text_digest)

    def get(self, key: tuple[str, str, str]) -> np.ndarray | None:
        with self._lock:
            embedding = self._entries.get(key)
            if embedding is not None:
                self._entries.move_to_end(key)
            return embedding

    def put(self, key: tuple[str, str, str], embedding: np.ndarray) -> None:
        with self._lock:
            self._entries[key] = embedding
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)

    def get_or_compute(self, key: tuple[str, str, str], compute):
        """Return the cached embedding, or compute it once for all waiting threads.

        Threads that miss on the same key wait on one call instead of each
        embedding the target. Only arrays are cached; a skipped result is
        returned as is, and the next waiter computes again.
        """
        cached = self.get(key)
        if cached is not None:
            return cached
        with self._lock:
            flight = self._in_flight.setdefault(key, threading.Lock())
        with flight:
            cached = self.get(key)
            if cached is not None:
                return cached
            try:
                result = compute()
                if isinstance(result, np.ndarray):
                    self.put(key, result)
                return result
            finally:
                with self._lock:
                    if self._in_flight.get(key) is flight:
                        del self._in_flight[key]

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


target_embedding_cache = TargetEmbeddingCache()


class CustomSimilarityEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None


class CustomSimilaritySettings(EvaluatorSettings):
    field: Literal["input", "output"] = "output"
    rule: Literal[
        "is_not_similar_to",
        "is_similar_to",
    ] = "is_not_similar_to"
    value: str = "example"
    threshold: float = 0.3
    embeddings_model: str = "openai/text-embedding-3-small"


class CustomSimilarityResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="How similar the input and output semantically, from 0.0 to 1.0, with 1.0 meaning the sentences are identical",
    )
    passed: Optional[bool] = Field(
        description="Passes if the cosine similarity crosses the threshold for the defined rule",
        default=None,
    )


class CustomSimilarityEvaluator(
    BaseEvaluator[
        CustomSimilarityEntry, CustomSimilaritySettings, CustomSimilarityResult
    ]
):
    """
    Allows you to check for semantic similarity or dissimilarity between input and output and a
    target value, so you can avoid sentences that you don't want to be present without having to
    match on the exact text.
    """

    name = "Semantic Similarity Evaluator"
    category = "custom"
    env_vars = []
    default_settings = CustomSimilaritySettings()
    is_guardrail = True

    def evaluate(self, entry: CustomSimilarityEntry) -> SingleEvaluationResult:
        target_value_embeddings = self.get_target_embeddings(self.settings.value)
        if isinstance(target_value_embeddings, EvaluationResultSkipped):
            return target_value_embeddings

        content = entry.input if self.settings.field == "input" else entry.output
        if not content:
            return EvaluationResultSkipped(details="No content to evaluate")
        entry_embeddings = self.get_embeddings(content)
        if isinstance(entry_embeddings, EvaluationResultSkipped):
            return entry_embeddings

        cosine_similarity = np.dot(target_value_embeddings, entry_embeddings) / (
            np.linalg.norm(target_value_embeddings) * np.linalg.norm(entry_embeddings)
        )

        details = (
            f'Cosine similarity of {cosine_similarity:.2f} between {self.settings.field} and "{self.settings.value}"'
            f' (threshold: {">" if self.settings.rule == "is_similar_to" else "<"} {self.settings.threshold})"'
        )

        if self.settings.rule == "is_similar_to":
            return CustomSimilarityResult(
                score=cosine_similarity,
                passed=cosine_similarity > self.settings.threshold,
                details=details,
            )
        else:
            return CustomSimilarityResult(
                score=cosine_similarity,
                passed=cosine_similarity < self.settings.threshold,
                details=details,
            )

    def get_target_embeddings(self, text: str):
        key = TargetEmbeddingCache.key(
            self.settings.embeddings_model, current_request_env(), text
        )
        return target_embedding_cache.get_or_compute(
            key, lambda: self.embed_target(text)
        )

    def embed_target(self, text: str):
        embedding = self.get_embeddings(text)
        if isinstance(embedding, EvaluationResultSkipped):
            return embedding

        # float64, the same precision np.dot gives the plain list, so the
        # score is identical whether the target came from the cache or not.
        array = np.asarray(embedding, dtype=np.float64)
        array.setflags(write=False)
        return array

    def get_embeddings(self, text: str):
        model = self.settings.embeddings_model

        total_tokens = len(litellm.encode(model=model, text=text))
        if total_tokens > DEFAULT_MAX_TOKENS:
            return EvaluationResultSkipped(
                details=f"Total tokens exceed the maximum of {DEFAULT_MAX_TOKENS} tokens: {total_tokens} tokens used"
            )

        response = litellm.embedding(model=model, input=text)
        return response.data[0]["embedding"]  # type: ignore
