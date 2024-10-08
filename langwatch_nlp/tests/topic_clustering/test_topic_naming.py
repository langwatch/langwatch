import os
import unittest
import pytest
from dotenv import load_dotenv

from langwatch_nlp.topic_clustering.topic_naming import (
    generate_topic_names,
    improve_similar_names,
)

load_dotenv()


class TopicClusteringTopicNamingTestCase(unittest.IsolatedAsyncioTestCase):
    @pytest.mark.integration
    async def test_it_generates_topic_names(self):
        topic_names, _cost = generate_topic_names(
            {
                "model": "azure/gpt-4-1106-preview",
                "api_base": os.environ["AZURE_OPENAI_ENDPOINT"],
            },
            [
                ["example1", "example2"],
                ["foo", "bar"],
            ],
        )

        assert len(topic_names) == 2
        print("\n\ntopic_names", topic_names, "\n\n")
        assert type(topic_names[0]) == str
        assert type(topic_names[1]) == str

        topic_names, _cost = improve_similar_names(
            model="azure/gpt-4-1106-preview",
            litellm_params={
                "model": "azure/gpt-4-1106-preview",
                "api_base": os.environ["AZURE_OPENAI_ENDPOINT"],
            },
            embeddings_litellm_params={"model": "openai/text-embedding-3-small"},
            topic_names=topic_names,  # type: ignore
            topic_examples=[
                ["example1", "example2"],
                ["foo", "bar"],
            ],
            max_iterations=3,
        )

        assert len(topic_names) == 2
        print("\n\nimproved topic_names", topic_names, "\n\n")
        assert type(topic_names[0]) == str
        assert type(topic_names[1]) == str

    @pytest.mark.integration
    async def test_it_avoid_already_existing_topic_names(self):
        topic_names = generate_topic_names(
            {
                "model": "azure/gpt-4-1106-preview",
                "api_base": os.environ["AZURE_OPENAI_ENDPOINT"],
            },
            [
                ["example1", "example2"],
                ["foo", "bar"],
            ],
            existing=["Generic Examples"],
        )

        print("\n\ntopic_names", topic_names, "\n\n")
        assert topic_names[0] != "Generic Examples"
