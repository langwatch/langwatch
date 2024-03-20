import unittest
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


class TopicClusteringIntegrationTestCase(unittest.IsolatedAsyncioTestCase):
    @pytest.mark.integration
    async def test_it_does_batch_clustering(self):
        # Look at the jupyter notebook to see how to download this data
        df = pd.read_csv(
            f"notebooks/data/traces_for_topics_project_iCTt0LSMXYbv5jZNSdtEr.csv"
        )
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

        response = client.post("/topics/batch_clustering", json={"traces": traces})
        result: TopicClusteringResponse = response.json()

        assert response.status_code == 200
        assert len(result["topics"]) > 0
        assert "Dutch" in result["topics"][0]["name"]
        assert len(result["subtopics"]) > 0
        assert len(result["traces"]) > 0
        assert result["cost"]["amount"] > 0

        response = client.post(
            "/topics/incremental_clustering",
            json={
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
