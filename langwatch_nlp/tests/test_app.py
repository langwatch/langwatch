import os
import pytest
from fastapi.testclient import TestClient
from langwatch_nlp.main import app

client = TestClient(app)


@pytest.mark.integration
@pytest.mark.skipif(
    not os.getenv("OPENAI_API_KEY"),
    reason="OPENAI_API_KEY environment variable not set"
)
def test_sentiment_analysis():
    text = "no, this is not what I wanted"

    response = client.post(
        "/sentiment",
        json={
            "text": text,
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
