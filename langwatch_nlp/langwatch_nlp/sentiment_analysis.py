import os
import litellm
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any, Optional


from tenacity import retry, stop_after_attempt, wait_random_exponential


# Pre-loaded embeddings
embeddings: dict[str, dict[str, list[list[float]]]] = {}


def load_embeddings(embeddings_litellm_params: dict[str, str]):
    global embeddings
    key = embeddings_litellm_params["model"]

    if key in embeddings:
        return embeddings[key]

    embeddings[key] = {
        "sentiment": [
            get_embedding(
                "Comment of a user who is extremely dissatisfied",
                embeddings_litellm_params,
            ),
            get_embedding(
                "Comment of a very happy and satisfied user",
                embeddings_litellm_params,
            ),
        ]
    }
    return embeddings[key]


@retry(wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(6), reraise=True)
def get_embedding(text: str, embeddings_litellm_params: dict[str, str]) -> list[float]:
    if "AZURE_API_VERSION" not in os.environ:
        os.environ["AZURE_API_VERSION"] = "2024-02-01"  # To make sure

    # replace newlines, which can negatively affect performance.
    text = text.replace("\n", " ")

    response = litellm.embedding(
        input=text, **embeddings_litellm_params  # type: ignore
    )

    data = response.data
    if data is None:
        raise ValueError("No data returned from the embedding model")
    return data[0]["embedding"]


class Embedding(BaseModel):
    vector: list[float]
    embeddings_litellm_params: dict[str, Any]


def setup_endpoints(app: FastAPI):
    @app.post("/sentiment")
    def sentiment_analysis(embedding: Embedding):
        vector = embedding.vector
        sentiment_embeddings = load_embeddings(embedding.embeddings_litellm_params)[
            "sentiment"
        ]
        positive_similarity = np.dot(vector, sentiment_embeddings[1]) / (
            np.linalg.norm(vector) * np.linalg.norm(sentiment_embeddings[1])
        )
        negative_similarity = np.dot(vector, sentiment_embeddings[0]) / (
            np.linalg.norm(vector) * np.linalg.norm(sentiment_embeddings[0])
        )

        score = float(positive_similarity - negative_similarity)
        score_n = min(1.0, score / (0.83 - 0.73))
        return {
            "score_normalized": score_n,
            "score_raw": score,
            "score_positive": float(positive_similarity),
            "score_negative": float(negative_similarity),
            "label": "negative" if score < 0 else "positive",
        }
