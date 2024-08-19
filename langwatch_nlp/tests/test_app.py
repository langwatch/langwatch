import os
import pytest
from fastapi.testclient import TestClient
from langwatch_nlp.main import app
from langwatch_nlp.sentiment_analysis import get_embedding

client = TestClient(app)


@pytest.mark.integration
def test_sentiment_analysis():
    text = "no, this is not what I wanted"
    embedding = get_embedding(
        text,
        embeddings_litellm_params={
            "api_key": os.environ["OPENAI_API_KEY"],
            "model": "text-embedding-3-small",
        },
    )

    response = client.post(
        "/sentiment",
        json={
            "vector": embedding,
            "embeddings_litellm_params": {
                "api_key": os.environ["OPENAI_API_KEY"],
                "model": "text-embedding-3-small",
            },
        },
    )

    assert response.status_code == 200

    response_data = response.json()
    assert response_data["label"] == "negative"
    assert response_data["score_positive"] < response_data["score_negative"]
    assert response_data["score_normalized"] < 0
    assert response_data["score_raw"] < 0
