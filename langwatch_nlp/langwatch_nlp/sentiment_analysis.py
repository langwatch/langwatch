import os
from openai import OpenAI, AzureOpenAI
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional


from tenacity import retry, stop_after_attempt, wait_random_exponential

azure_client = AzureOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT") or "",
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-02-01",
)
openai_client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
)

# Pre-loaded embeddings
embeddings: Optional[dict[str, list[list[float]]]] = None


def load_embeddings(model="text-embedding-3-small"):
    global embeddings
    if embeddings is not None:
        return embeddings

    embeddings = {
        "sentiment": [
            get_embedding("Comment of a user who is extremely dissatisfied", model),
            get_embedding("Comment of a very happy and satisfied user", model),
        ]
    }
    return embeddings


@retry(wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(6))
def get_embedding(text: str, model, **kwargs) -> list[float]:
    # replace newlines, which can negatively affect performance.
    text = text.replace("\n", " ")

    # response = azure_openai.embeddings.create(input=[text], model=model, **kwargs)
    # Temporary until text-embedding-3-small is also available on azure: https://learn.microsoft.com/en-us/answers/questions/1531681/openai-new-embeddings-model
    response = openai_client.embeddings.create(input=[text], model=model, **kwargs)

    return response.data[0].embedding


class Embedding(BaseModel):
    vector: list[float]


def setup_endpoints(app: FastAPI):
    @app.post("/sentiment")
    def sentiment_analysis(embedding: Embedding):
        vector = embedding.vector
        sentiment_embeddings = load_embeddings()["sentiment"]
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
