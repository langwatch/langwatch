import numpy as np
from scipy.spatial.distance import cdist


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
