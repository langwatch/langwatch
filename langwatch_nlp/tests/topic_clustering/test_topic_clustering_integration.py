import json
import os
import random
import re
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pandas as pd
import pytest
from dotenv import load_dotenv

load_dotenv()
import langwatch_nlp.topic_clustering.batch_clustering as batch_clustering
import langwatch_nlp.topic_clustering.incremental_clustering as incremental_clustering

from langwatch_nlp.topic_clustering.types import TopicClusteringResponse, Trace


app = FastAPI()
client = TestClient(app)
batch_clustering.setup_endpoints(app)
incremental_clustering.setup_endpoints(app)


class TestTopicClusteringIntegration:
    @pytest.mark.integration
    @pytest.mark.asyncio
    # NOTE: disable httpx_mock to see it working fully integrated
    async def test_it_does_batch_clustering(self):
        # Look at the jupyter notebook to see how to download this data
        df = pd.read_csv(f"notebooks/data/traces_for_topics_KAXYxPR8MUgTcP8CF193y.csv")
        df["embeddings"] = df["embeddings"].apply(
            lambda x: list(map(float, x[1:-1].split(", ")))
        )

        traces: list[Trace] = []
        for _, row in df[0:100].iterrows():
            traces.append(
                Trace(
                    trace_id=row["trace_id"],
                    input=row["input"],
                    embeddings=row["embeddings"],
                    topic_id=None,
                    subtopic_id=None,
                )
            )

        response = client.post(
            "/topics/batch_clustering",
            json={
                "model": "azure/gpt-4-1106-preview",
                "litellm_params": {"api_base": os.environ["AZURE_OPENAI_ENDPOINT"]},
                "embeddings_litellm_params": {
                    "api_key": os.environ["OPENAI_API_KEY"],
                    "model": "openai/text-embedding-3-small",
                },
                "traces": traces,
            },
        )
        result: TopicClusteringResponse = response.json()

        assert response.status_code == 200
        assert len(result["topics"]) > 0
        assert type(result["topics"][0]["name"]) == str
        assert len(result["subtopics"]) > 0
        assert len(result["traces"]) > 0
        assert result["cost"]["amount"] > 0

        response = client.post(
            "/topics/incremental_clustering",
            json={
                "model": "azure/gpt-4-1106-preview",
                "litellm_params": {"api_base": os.environ["AZURE_OPENAI_ENDPOINT"]},
                "embeddings_litellm_params": {
                    "api_key": os.environ["OPENAI_API_KEY"],
                    "model": "openai/text-embedding-3-small",
                },
                "topics": result["topics"],
                "subtopics": result["subtopics"],
                "traces": traces,
            },
        )

        assert response.status_code == 200
        result: TopicClusteringResponse = response.json()

        assert len(result["traces"]) > 0
        assert len(result["topics"]) == 0
        assert len(result["subtopics"]) == 0
        assert result["cost"]["amount"] == 0
