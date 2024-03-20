import unittest
import pytest
from dotenv import load_dotenv

from langwatch_nlp.topic_clustering.topic_naming import generate_topic_names

load_dotenv()


class TopicClusteringTopicNamingTestCase(unittest.IsolatedAsyncioTestCase):
    @pytest.mark.integration
    async def test_it_generates_topic_names(self):
        topic_names = generate_topic_names(
            [
                ["example1", "example2"],
                ["foo", "bar"],
            ]
        )

        assert topic_names == ["Generic Examples", "Placeholder Names"]

    @pytest.mark.integration
    async def test_it_avoid_already_existing_topic_names(self):
        topic_names = generate_topic_names(
            [
                ["example1", "example2"],
                ["foo", "bar"],
            ],
            existing=["Generic Examples"],
        )

        assert topic_names[0] != "Generic Examples"
