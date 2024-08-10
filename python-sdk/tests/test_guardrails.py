import asyncio
from unittest.mock import patch
import pytest
from pytest_httpx import HTTPXMock
import requests_mock

from openai import AsyncOpenAI
import langwatch
import langwatch.guardrails
import langwatch.openai
from tests.utils import create_openai_chat_completion_mock


langwatch.api_key = "test"


class TestGuardrailsIntegration:
    @pytest.mark.asyncio
    async def test_guardrails_and_openai_integration(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        requests_mock.post(
            langwatch.endpoint + "/api/evaluations/azure-jailbreak-detection/evaluate",
            json={"status": "processed", "passed": True},
        )

        httpx_mock.add_response(
            json=create_openai_chat_completion_mock("Hello, how can I help you?"),
            url="https://api.openai.com/v1/chat/completions",
        )

        client = AsyncOpenAI(api_key="test")
        message_content = "Test message"
        with langwatch.openai.OpenAITracer(client):
            jailbreak_guardrail = await langwatch.guardrails.async_evaluate(
                "azure-jailbreak-detection", input=message_content
            )
            print("\n\njailbreak_guardrail", jailbreak_guardrail, "\n\n")
            assert jailbreak_guardrail.passed

            completion = await client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": message_content}],
                stream=True,
            )

            async for part in completion:
                assert part.choices[0].delta.content == "Hello, how can I help you?"
