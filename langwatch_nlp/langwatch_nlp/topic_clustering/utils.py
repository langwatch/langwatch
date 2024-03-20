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
