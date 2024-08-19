import json
import os
import random
import re
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
import pandas as pd
import pytest
from dotenv import load_dotenv

load_dotenv()
import langwatch_nlp.topic_clustering.batch_clustering as batch_clustering
import langwatch_nlp.topic_clustering.incremental_clustering as incremental_clustering

from langwatch_nlp.topic_clustering.types import TopicClusteringResponse, Trace
from pytest_httpx import HTTPXMock


app = FastAPI()
client = TestClient(app)
batch_clustering.setup_endpoints(app)
incremental_clustering.setup_endpoints(app)


class TestTopicClusteringIntegration:
    @pytest.mark.asyncio
    async def test_it_does_batch_clustering(self, httpx_mock: HTTPXMock):
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

        def mock_openai(request: httpx.Request):
            if "/embeddings" in str(request.url):
                return httpx.Response(
                    status_code=200,
                    json={
                        "object": "list",
                        "data": [
                            {
                                "object": "embedding",
                                "index": 0,
                                "embedding": [random.random()] * 1536,
                            }
                        ],
                        "model": "text-embedding-3-small",
                        "usage": {"prompt_tokens": 5, "total_tokens": 5},
                    },
                )

            return httpx.Response(
                status_code=200,
                json=create_openai_chat_completion_mock(
                    len(re.findall(r"topic_\d+", str(request.content)))
                ),
            )

        httpx_mock.add_callback(
            mock_openai,
        )

        response = client.post(
            "/topics/batch_clustering",
            json={
                "model": "openai/gpt-4o",
                "litellm_params": {},
                "embeddings_litellm_params": {
                    "model": "openai/text-embedding-3-small",
                    "api_key": os.environ["OPENAI_API_KEY"],
                },
                "traces": traces,
            },
        )
        result: TopicClusteringResponse = response.json()

        assert response.status_code == 200
        assert len(result["topics"]) > 0
        assert "sample topic name" in result["topics"][0]["name"]
        assert len(result["subtopics"]) > 0
        assert len(result["traces"]) > 0
        assert result["cost"]["amount"] > 0

        response = client.post(
            "/topics/incremental_clustering",
            json={
                "model": "openai/gpt-4o",
                "litellm_params": {},
                "embeddings_litellm_params": {
                    "model": "openai/text-embedding-3-small",
                    "api_key": os.environ["OPENAI_API_KEY"],
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

    @pytest.mark.asyncio
    @pytest.mark.skip  # uncomment to run this test, it intentionally throws errors multiple times before succeeding to test retry and error handling
    async def test_it_works_even_if_azure_throws_error_for_certain_requests(
        self, httpx_mock: HTTPXMock
    ):
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

        requests = {}

        def fail_specific_request(request: httpx.Request):
            if "/embeddings" in str(request.url):
                return httpx.Response(
                    status_code=200,
                    json={
                        "object": "list",
                        "data": [
                            {
                                "object": "embedding",
                                "index": 0,
                                "embedding": [random.random()] * 1536,
                            }
                        ],
                        "model": "text-embedding-3-small",
                        "usage": {"prompt_tokens": 5, "total_tokens": 5},
                    },
                )

            if str(request.content) not in requests:
                requests[str(request.content)] = True

            if list(requests.keys()).index(str(request.content)) == 0:
                raise Exception("stop")

            return httpx.Response(
                status_code=200,
                json=create_openai_chat_completion_mock(
                    len(re.findall(r"topic_\d+", str(request.content)))
                ),
            )

        httpx_mock.add_callback(
            fail_specific_request,
        )

        response = client.post(
            "/topics/batch_clustering",
            json={
                "model": "openai/gpt-4o",
                "litellm_params": {},
                "embeddings_litellm_params": {
                    "model": "openai/text-embedding-3-small",
                    "api_key": os.environ["OPENAI_API_KEY"],
                },
                "traces": traces,
            },
        )

        assert response.status_code == 200
        assert response.json()


def create_openai_chat_completion_mock(n):
    return {
        "id": "chatcmpl-86zIvz53Wa4qTc1ksUt3coF5yTvm7",
        "object": "chat.completion",
        "created": 1696676313,
        "model": "gpt-3.5-turbo-0613",
        "choices": [
            {
                "index": 0,
                "logprobs": None,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "function_call": None,
                    "tool_calls": [
                        {
                            "function": {
                                "name": "test",
                                "arguments": json.dumps(
                                    dict(
                                        [
                                            (f"topic_{index}", "sample topic name")
                                            for index in range(n)
                                        ]
                                    )
                                ),
                            }
                        }
                    ],
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 16, "total_tokens": 21},
        "system_fingerprint": None,
    }
