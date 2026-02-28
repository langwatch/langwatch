import os
import litellm
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Optional


from tenacity import retry, stop_after_attempt, wait_random_exponential

from langwatch_nlp.topic_clustering.utils import (
    generate_embeddings,
    normalize_embedding_dimensions,
)
from langwatch_nlp.logger import get_logger, set_log_context, clear_log_context

logger = get_logger("sentiment_analysis")


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


@retry(
    wait=wait_random_exponential(min=1, max=20),
    stop=stop_after_attempt(6),
    reraise=True,
)
def get_embedding(text: str, embeddings_litellm_params: dict[str, str]) -> list[float]:
    if "AZURE_API_VERSION" not in os.environ:
        os.environ["AZURE_API_VERSION"] = "2024-02-01"  # To make sure

    # replace newlines, which can negatively affect performance.
    text = text.replace("\n", " ")

    if "dimensions" in embeddings_litellm_params:
        # TODO: target_dim is throwing errors for text-embedding-3-small because litellm drop_params is also not working for some reason
        del embeddings_litellm_params["dimensions"]
    response = litellm.embedding(
        input=text,
        drop_params=True,
        **embeddings_litellm_params,  # type: ignore
    )

    data = response.data
    if data is None:
        raise ValueError("No data returned from the embedding model")
    embedding = data[0]["embedding"]
    return normalize_embedding_dimensions(
        embedding, target_dim=int(embeddings_litellm_params.get("dimensions", 1536))
    )


class SentimentAnalysisParams(BaseModel):
    project_id: Optional[str] = None
    text: str
    embeddings_litellm_params: dict[str, Any]


def setup_endpoints(app: FastAPI):
    @app.post("/sentiment")
    def sentiment_analysis(params: SentimentAnalysisParams):
        try:
            if params.project_id:
                set_log_context(project_id=params.project_id)

            logger.info("Starting sentiment analysis", text_length=len(params.text))

            # Validate API key configuration
            embeddings_api_key = params.embeddings_litellm_params.get("api_key", "")
            if embeddings_api_key in ("", "dummy"):
                logger.warning("Invalid API key for sentiment analysis, skipping")
                raise HTTPException(
                    status_code=422,
                    detail="Invalid or missing API key for embeddings model",
                )

            vector = generate_embeddings([params.text], params.embeddings_litellm_params)[0]
            if vector is None:
                raise ValueError("No vector returned from the embedding model")
            sentiment_embeddings = load_embeddings(params.embeddings_litellm_params)[
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

            logger.info("Sentiment analysis complete", label="negative" if score < 0 else "positive", score_normalized=round(score_n, 3))

            return {
                "score_normalized": score_n,
                "score_raw": score,
                "score_positive": float(positive_similarity),
                "score_negative": float(negative_similarity),
                "label": "negative" if score < 0 else "positive",
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Sentiment analysis failed", error=str(e), error_type=type(e).__name__)
            raise HTTPException(status_code=500, detail="Sentiment analysis failed") from e
        finally:
            clear_log_context()
