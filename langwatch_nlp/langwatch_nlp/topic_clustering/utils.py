from typing import Optional
import litellm
import numpy as np
from scipy.spatial.distance import cdist

from langwatch_nlp.topic_clustering.types import Trace, TraceWithEmbeddings


def calculate_centroid_and_distance(samples) -> tuple[np.ndarray, float]:
    centroid = np.mean([np.array(item["embeddings"]) for item in samples], axis=0)
    distances = cdist(
        [np.array(item["embeddings"]) for item in samples],
        np.array([centroid]),
        "cosine",
    ).flatten()
    p95_distance = np.percentile(distances, 95).astype(float)

    return centroid, p95_distance


def normalize_embedding_dimensions(
    embedding: list[float], target_dim: int = 1536
) -> list[float]:
    if len(embedding) == target_dim:
        return embedding

    if len(embedding) < target_dim:
        return embedding + [0.0] * (target_dim - len(embedding))

    return embedding[:target_dim]


def generate_embeddings(
    texts: list[str], embeddings_litellm_params: dict[str, str], batch_size: int = 20
) -> list[Optional[list[float]]]:
    embeddings = []
    errors = 0
    last_error: Optional[Exception] = None
    batches = range(0, len(texts), batch_size)

    dimensions = int(embeddings_litellm_params.get("dimensions", 1536))
    if "dimensions" in embeddings_litellm_params:
        # TODO: target_dim is throwing errors for text-embedding-3-small because litellm drop_params is also not working for some reason
        del embeddings_litellm_params["dimensions"]

    for i in batches:
        batch = [t if t else "<empty>" for t in texts[i : i + batch_size]]
        try:
            response = litellm.embedding(
                **embeddings_litellm_params,  # type: ignore
                input=batch if batch_size > 1 else batch[0],
            )
            embeddings += [
                normalize_embedding_dimensions(
                    item["embedding"],
                    target_dim=dimensions,
                )
                for item in response.data
            ]
        except Exception as e:
            if batch_size > 1:
                return generate_embeddings(
                    texts, embeddings_litellm_params, batch_size=1
                )
            embeddings += [None] * batch_size

            errors += 1
            last_error = e
            print(f"[WARN] Error generating embeddings: {e}\n\nBatch: {batch}\n\n")
            if errors >= 3:
                print(f"[WARN] Too many errors generating embeddings, reraising")
                raise e

    if last_error and errors == len(batches):
        print(f"[WARN] All embeddings failed to generate, reraising last error")
        raise last_error

    return embeddings


def fill_embeddings(
    traces: list[Trace], embeddings_litellm_params: dict[str, str]
) -> list[TraceWithEmbeddings]:
    traces_ = [t for t in traces if t["input"] and len(t["input"].strip()) > 0]
    embeddings = generate_embeddings(
        [t["input"] for t in traces_], embeddings_litellm_params
    )
    return [
        TraceWithEmbeddings(
            trace_id=trace["trace_id"],
            input=trace["input"],
            embeddings=embedding,
            topic_id=trace["topic_id"],
            subtopic_id=trace["subtopic_id"],
        )
        for trace, embedding in zip(traces_, embeddings)
        if embedding is not None
    ]
