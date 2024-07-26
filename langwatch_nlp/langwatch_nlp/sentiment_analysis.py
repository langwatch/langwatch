import os
import litellm
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional


from tenacity import retry, stop_after_attempt, wait_random_exponential


# Pre-loaded embeddings
embeddings: dict[str, dict[str, list[list[float]]]] = {}


def load_embeddings(model: str, deployment_name: Optional[str] = None):
    global embeddings
    key = f"{model}_{deployment_name}"

    if key in embeddings:
        return embeddings[key]

    embeddings[key] = {
        "sentiment": [
            get_embedding(
                "Comment of a user who is extremely dissatisfied",
                model,
                deployment_name,
            ),
            get_embedding(
                "Comment of a very happy and satisfied user", model, deployment_name
            ),
        ]
    }
    return embeddings[key]


@retry(wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(6))
def get_embedding(
    text: str, model, deployment_name: Optional[str] = None, **kwargs
) -> list[float]:
    if "AZURE_API_VERSION" not in os.environ:
        os.environ["AZURE_API_VERSION"] = "2024-02-01"  # To make sure

    # replace newlines, which can negatively affect performance.
    text = text.replace("\n", " ")

    if model.startswith("azure/") and deployment_name:
        model = f"azure/{deployment_name}"

    response = litellm.embedding(model=model, input=[text], **kwargs)

    data = response.data
    if data is None:
        raise ValueError("No data returned from the embedding model")
    return data[0]["embedding"]


class Embedding(BaseModel):
    vector: list[float]
    embeddings_model: str = "text-embedding-3-small"
    embeddings_deployment_name: Optional[str] = None


def setup_endpoints(app: FastAPI):
    @app.post("/sentiment")
    def sentiment_analysis(embedding: Embedding):
        vector = embedding.vector
        sentiment_embeddings = load_embeddings(
            embedding.embeddings_model, embedding.embeddings_deployment_name
        )["sentiment"]
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
