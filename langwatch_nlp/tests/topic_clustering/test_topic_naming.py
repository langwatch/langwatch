import os
import unittest
import pytest

from langwatch_nlp.topic_clustering.topic_naming import (
    generate_topic_names,
    improve_similar_names,
)

# These integration tests call a live Azure/OpenAI deployment, so transient
# provider 5xx and rate limiting are not code bugs and must not fail CI.
# Providers vary the human-readable message but tag server-side failures with a
# "server_error" type, so match that plus the common transient signals.
_TRANSIENT_PROVIDER_ERRORS = (
    "server_error",
    "The server had an error",
    "Backend returned unexpected response",
    "Rate limit",
    "RateLimitError",
    "Connection error",
    "Service Unavailable",
    "Timeout",
    "Request timed out",
)


def _skip_if_transient_provider_error(error: Exception) -> None:
    message = str(error)
    if any(indicator in message for indicator in _TRANSIENT_PROVIDER_ERRORS):
        pytest.skip(f"Skipping due to transient provider error: {error}")


class TopicClusteringTopicNamingTestCase(unittest.IsolatedAsyncioTestCase):
    @pytest.mark.integration
    @pytest.mark.skipif(
        not os.getenv("AZURE_OPENAI_ENDPOINT"),
        reason="AZURE_OPENAI_ENDPOINT environment variable not set"
    )
    async def test_it_generates_topic_names(self):
        try:
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
            assert isinstance(topic_names[0], str)
            assert isinstance(topic_names[1], str)

            topic_names, _cost = improve_similar_names(
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
            assert isinstance(topic_names[0], str)
            assert isinstance(topic_names[1], str)
        except Exception as error:
            _skip_if_transient_provider_error(error)
            raise

    @pytest.mark.integration
    @pytest.mark.skipif(
        not os.getenv("AZURE_OPENAI_ENDPOINT"),
        reason="AZURE_OPENAI_ENDPOINT environment variable not set"
    )
    async def test_it_avoid_already_existing_topic_names(self):
        try:
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
        except Exception as error:
            _skip_if_transient_provider_error(error)
            raise
