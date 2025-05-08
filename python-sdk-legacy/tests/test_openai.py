from dotenv import load_dotenv

load_dotenv()

import asyncio
from datetime import datetime
import time
from freezegun import freeze_time
from unittest.mock import patch
import pytest
from openai import OpenAI, AsyncOpenAI
import langwatch
import langwatch.openai
import requests_mock

from tests.utils import *  # type: ignore
from pytest_httpx import HTTPXMock
from openai.types.chat import ChatCompletionToolParam

client = OpenAI()
async_client = AsyncOpenAI()


class TestOpenAICompletionTracer:
    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_calls(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        openai_mocks = [
            create_openai_completion_mock(" there"),
            create_openai_completion_mock(" bar"),
            create_openai_completion_mock(" you!"),
            create_openai_completion_mock(" ah!"),
        ]
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(openai_mocks),
            url="https://api.openai.com/v1/completions",
        )

        with langwatch.openai.OpenAICompletionTracer(
            client,
            metadata={
                "user_id": "user-123",
                "thread_id": "thread-456",
                "customer_id": "customer-789",
            },
        ):
            response = client.completions.create(
                model="gpt-3.5-turbo-instruct", prompt="hi"
            )
            assert response.model_dump() == openai_mocks[0]
            response = client.completions.create(
                model="gpt-3.5-turbo-instruct", prompt="foo"
            )
            assert response.model_dump() == openai_mocks[1]

        time.sleep(0.01)
        trace_request = requests_mock.request_history[0].json()

        assert trace_request["metadata"]["user_id"] == "user-123"
        assert trace_request["metadata"]["thread_id"] == "thread-456"
        assert trace_request["metadata"]["customer_id"] == "customer-789"

        first_span, second_span = trace_request["spans"]

        assert first_span["trace_id"].startswith("trace_")
        assert first_span["vendor"] == "openai"
        assert first_span["model"] == "gpt-3.5-turbo-instruct"
        assert first_span["input"] == {"type": "text", "value": "hi"}
        assert first_span["outputs"] == [
            {
                "type": "text",
                "value": " there",
            }
        ]
        assert first_span["params"] == {"temperature": 1, "stream": False}
        assert first_span["metrics"] == {
            "prompt_tokens": 5,
            "completion_tokens": 16,
        }
        assert first_span["timestamps"]["started_at"] == int(
            datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
        )
        assert first_span["timestamps"]["finished_at"] >= int(
            datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
        )

        assert second_span["trace_id"] == first_span["trace_id"]

        with langwatch.openai.OpenAICompletionTracer(client):
            client.completions.create(
                model="gpt-3.5-turbo-instruct", prompt="we will we will rock"
            )
            client.completions.create(
                model="gpt-3.5-turbo-instruct", prompt="heey hey baby uh"
            )

        time.sleep(0.01)
        third_span = requests_mock.request_history[1].json()["spans"][0]
        assert third_span["trace_id"] != first_span["trace_id"]

        fourth_span = requests_mock.request_history[1].json()["spans"][1]
        assert fourth_span["trace_id"] == third_span["trace_id"]

    def test_trace_session_captures_exceptions(
        self, requests_mock: requests_mock.Mocker
    ):
        with patch.object(
            client.completions,
            "create",
            side_effect=Exception("An error occurred!"),
        ):
            requests_mock.post(langwatch.endpoint + "/api/collector", json={})

            with pytest.raises(Exception) as err:
                with langwatch.openai.OpenAICompletionTracer(client):
                    client.completions.create(
                        model="gpt-3.5-turbo-instruct", prompt="hi"
                    )
            assert str(err.value) == "An error occurred!"

            time.sleep(0.01)
            traced = requests_mock.request_history[0].json()["spans"][0]
            assert traced["error"]["message"] == "An error occurred!"
            assert len(traced["error"]["stacktrace"]) > 0

    @pytest.mark.asyncio
    async def test_trace_session_captures_openai_async_calls(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        openai_mocks = [
            create_openai_completion_mock(" there"),
        ]
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(openai_mocks),
            url="https://api.openai.com/v1/completions",
        )

        with langwatch.openai.OpenAICompletionTracer(async_client):
            response = await async_client.completions.create(
                model="gpt-3.5-turbo-instruct", prompt="hi"
            )
            assert response.model_dump() == openai_mocks[0]

        await asyncio.sleep(0.1)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["outputs"] == [
            {
                "type": "text",
                "value": " there",
            }
        ]

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_streams(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_response(
            stream=create_openai_completion_stream_mock(
                [" there", " all", " good?"], [" how", " are", " you"]
            ),
            url="https://api.openai.com/v1/completions",
        )

        with langwatch.openai.OpenAICompletionTracer(client):
            response = client.completions.create(
                model="gpt-3.5-turbo-instruct", prompt="hi", stream=True, n=2
            )
            texts = []
            for chunk in response:
                texts.append(chunk.choices[0].text)
            assert texts == [" there", " all", " good?", " how", " are", " you"]

        time.sleep(0.01)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["outputs"] == [
            {
                "type": "text",
                "value": " there all good?",
            },
            {
                "type": "text",
                "value": " how are you",
            },
        ]
        assert first_span["vendor"] == "openai"
        assert first_span["model"] == "gpt-3.5-turbo-instruct"
        assert first_span["params"] == {"temperature": 1, "stream": True}
        assert first_span["timestamps"]["started_at"] == int(
            datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
        )
        assert first_span["timestamps"]["first_token_at"] >= int(
            datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
        )
        assert first_span["timestamps"]["finished_at"] >= int(
            datetime(2022, 1, 1, 0, 0, 30).timestamp() * 1000
        )

    @pytest.mark.asyncio
    async def test_trace_session_captures_openai_async_streams(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_response(
            stream=create_openai_completion_stream_mock(
                [" there", " all", " good?"], [" how", " are", " you"]
            ),
            url="https://api.openai.com/v1/completions",
        )

        with langwatch.openai.OpenAICompletionTracer(async_client):
            response = await async_client.completions.create(
                model="gpt-3.5-turbo-instruct", prompt="hi", stream=True, n=2
            )
            texts = []
            async for chunk in response:
                texts.append(chunk.choices[0].text)
            assert texts == [" there", " all", " good?", " how", " are", " you"]

        time.sleep(0.01)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["outputs"] == [
            {
                "type": "text",
                "value": " there all good?",
            },
            {
                "type": "text",
                "value": " how are you",
            },
        ]
        assert first_span["vendor"] == "openai"
        assert first_span["model"] == "gpt-3.5-turbo-instruct"
        assert first_span["params"] == {"temperature": 1, "stream": True}

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_nested_spans(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(
                [
                    create_openai_completion_mock(" there"),
                    create_openai_completion_mock(" are"),
                    create_openai_completion_mock("?"),
                ]
            ),
            url="https://api.openai.com/v1/completions",
        )

        with langwatch.openai.OpenAICompletionTracer(client):
            client.completions.create(model="gpt-3.5-turbo-instruct", prompt="hi")
            with langwatch.create_span("subtask"):
                client.completions.create(model="gpt-3.5-turbo-instruct", prompt="how")
                client.completions.create(model="gpt-3.5-turbo-instruct", prompt="you")

        time.sleep(0.01)

        (
            first_span,
            second_span,
            third_span,
            fourth_span,
        ) = requests_mock.request_history[0].json()["spans"]

        assert first_span["type"] == "llm"
        assert first_span["trace_id"].startswith("trace_")
        assert first_span["span_id"].startswith("span_")
        assert first_span["parent_id"] == None

        assert fourth_span["type"] == "span"
        assert fourth_span["name"] == "subtask"
        assert fourth_span["trace_id"] == first_span["trace_id"]
        assert fourth_span["span_id"].startswith("span_")
        assert fourth_span["parent_id"] == None

        assert second_span["type"] == "llm"
        assert second_span["trace_id"] == first_span["trace_id"]
        assert second_span["parent_id"] == fourth_span["span_id"]

        assert third_span["type"] == "llm"
        assert third_span["trace_id"] == first_span["trace_id"]
        assert third_span["parent_id"] == fourth_span["span_id"]

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_nested_spans_using_annotations(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(
                [
                    create_openai_completion_mock(" there"),
                    create_openai_completion_mock(" are"),
                    create_openai_completion_mock("?"),
                ]
            ),
            url="https://api.openai.com/v1/completions",
        )

        @langwatch.span()
        def subtask(foo=None):
            client.completions.create(model="gpt-3.5-turbo-instruct", prompt="how")
            client.completions.create(model="gpt-3.5-turbo-instruct", prompt="you")

            return foo

        with langwatch.openai.OpenAICompletionTracer(client):
            client.completions.create(model="gpt-3.5-turbo-instruct", prompt="hi")
            subtask(foo="bar")

        time.sleep(0.01)

        (
            first_span,
            second_span,
            third_span,
            fourth_span,
        ) = requests_mock.request_history[0].json()["spans"]

        assert first_span["type"] == "llm"
        assert first_span["trace_id"].startswith("trace_")
        assert first_span["span_id"].startswith("span_")
        assert first_span["parent_id"] == None

        assert fourth_span["type"] == "span"
        assert fourth_span["name"] == "subtask"
        assert fourth_span["input"] == {"type": "json", "value": {"foo": "bar"}}
        assert fourth_span["outputs"] == [{"type": "text", "value": "bar"}]
        assert fourth_span["trace_id"] == first_span["trace_id"]
        assert fourth_span["span_id"].startswith("span_")
        assert fourth_span["parent_id"] == None

        assert second_span["type"] == "llm"
        assert second_span["trace_id"] == first_span["trace_id"]
        assert second_span["parent_id"] == fourth_span["span_id"]

        assert third_span["type"] == "llm"
        assert third_span["trace_id"] == first_span["trace_id"]
        assert third_span["parent_id"] == fourth_span["span_id"]


class TestOpenAIChatCompletionTracer:
    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_calls(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        openai_mocks = [
            create_openai_chat_completion_mock("hi there!"),
            create_openai_chat_completion_mock("bar baz"),
        ]
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(openai_mocks),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAIChatCompletionTracer(
            client,
            metadata={
                "user_id": "user-123",
                "thread_id": "thread-456",
                "customer_id": "customer-789",
                "labels": ["1.0.0"],
            },
        ):
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": "Hello!"}],
            )
            assert response.model_dump() == openai_mocks[0]
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": "foo"}],
            )
            assert response.model_dump() == openai_mocks[1]

        time.sleep(0.01)
        trace_request = requests_mock.request_history[0].json()

        assert trace_request["trace_id"].startswith("trace_")
        assert trace_request["metadata"]["user_id"] == "user-123"
        assert trace_request["metadata"]["thread_id"] == "thread-456"
        assert trace_request["metadata"]["customer_id"] == "customer-789"
        assert trace_request["metadata"]["labels"] == ["1.0.0"]

        first_span = trace_request["spans"][0]
        assert first_span["trace_id"].startswith("trace_")
        assert first_span["vendor"] == "openai"
        assert first_span["model"] == "gpt-3.5-turbo"
        assert first_span["input"] == {
            "type": "chat_messages",
            "value": [
                {
                    "role": "user",
                    "content": "Hello!",
                }
            ],
        }
        assert first_span["outputs"] == [
            {
                "type": "chat_messages",
                "value": [
                    {
                        "role": "assistant",
                        "content": "hi there!",
                        "function_call": None,
                        "tool_calls": None,
                    }
                ],
            }
        ]
        assert first_span["params"] == {"temperature": 1, "stream": False}
        assert first_span["metrics"] == {
            "prompt_tokens": 5,
            "completion_tokens": 16,
        }
        assert first_span["timestamps"]["started_at"] == int(
            datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
        )
        assert first_span["timestamps"]["finished_at"] >= int(
            datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
        )

        second_span = requests_mock.request_history[0].json()["spans"][1]
        assert second_span["trace_id"] == first_span["trace_id"]

    def test_trace_session_captures_exceptions(
        self, requests_mock: requests_mock.Mocker
    ):
        with patch.object(
            client.chat.completions,
            "create",
            side_effect=Exception("An error occurred!"),
        ):
            requests_mock.post(langwatch.endpoint + "/api/collector", json={})

            with pytest.raises(Exception) as err:
                with langwatch.openai.OpenAIChatCompletionTracer(client):
                    client.chat.completions.create(model="gpt-3.5-turbo", messages=[])
            assert str(err.value) == "An error occurred!"

            time.sleep(0.01)
            traced = requests_mock.request_history[0].json()["spans"][0]
            assert traced["error"]["message"] == "An error occurred!"
            assert len(traced["error"]["stacktrace"]) > 0

    @pytest.mark.asyncio
    async def test_trace_session_captures_openai_async_calls(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        openai_mocks = [
            create_openai_chat_completion_mock("hi there!"),
        ]
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(openai_mocks),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAIChatCompletionTracer(async_client):
            response = await async_client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": "Hello!"}],
            )
            assert response.model_dump() == openai_mocks[0]

        await asyncio.sleep(0.1)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["outputs"] == [
            {
                "type": "chat_messages",
                "value": [
                    {
                        "role": "assistant",
                        "content": "hi there!",
                        "function_call": None,
                        "tool_calls": None,
                    }
                ],
            }
        ]

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_function_calls(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        openai_mocks = [
            {
                "id": "chatcmpl-86zIvz53Wa4qTc1ksUt3coF5yTvm7",
                "object": "chat.completion",
                "created": 1696676313,
                "model": "gpt-3.5-turbo-0613",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "function_call": {
                                "arguments": '{\n  "input": "2+2"\n}',
                                "name": "Calculator",
                            },
                            "content": None,
                        },
                        "finish_reason": "function_call",
                    }
                ],
                "usage": {
                    "prompt_tokens": 5,
                    "completion_tokens": 16,
                    "total_tokens": 21,
                },
            }
        ]
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(openai_mocks),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAIChatCompletionTracer(client):
            client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": "how much is 2 + 2?"}],
                functions=[
                    {
                        "name": "Calculator",
                        "description": "useful for when you need to answer questions about math",
                        "parameters": {
                            "properties": {
                                "expression": {
                                    "title": "expression",
                                    "type": "string",
                                }
                            },
                            "required": ["expression"],
                            "type": "object",
                        },
                    }
                ],
            )

        time.sleep(0.01)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["trace_id"].startswith("trace_")
        assert first_span["vendor"] == "openai"
        assert first_span["model"] == "gpt-3.5-turbo"
        assert first_span["input"] == {
            "type": "chat_messages",
            "value": [{"role": "user", "content": "how much is 2 + 2?"}],
        }
        assert first_span["outputs"] == [
            {
                "type": "chat_messages",
                "value": [
                    {
                        "role": "assistant",
                        "content": None,
                        "function_call": {
                            "name": "Calculator",
                            "arguments": '{\n  "input": "2+2"\n}',
                        },
                        "tool_calls": None,
                    }
                ],
            }
        ]
        assert first_span["params"] == {
            "temperature": 1.0,
            "stream": False,
            "functions": [
                {
                    "name": "Calculator",
                    "description": "useful for when you need to answer questions about math",
                    "parameters": {
                        "properties": {
                            "expression": {"title": "expression", "type": "string"}
                        },
                        "required": ["expression"],
                        "type": "object",
                    },
                }
            ],
        }

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_streams(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_response(
            stream=create_openai_chat_completion_stream_mock(
                ["Hi", " there", " all", " good?"], ["Hi", " how", " are", " you"]
            ),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAIChatCompletionTracer(client):
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": "Hello!"}],
                stream=True,
                n=2,
            )
            texts = []
            for chunk in response:
                texts.append(chunk.choices[0].delta.content)
            assert texts == [
                "",
                "",
                "Hi",
                " there",
                " all",
                " good?",
                "Hi",
                " how",
                " are",
                " you",
                None,
                None,
            ]

        time.sleep(0.01)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["outputs"] == [
            {
                "type": "chat_messages",
                "value": [{"role": "assistant", "content": "Hi there all good?"}],
            },
            {
                "type": "chat_messages",
                "value": [{"role": "assistant", "content": "Hi how are you"}],
            },
        ]
        assert first_span["vendor"] == "openai"
        assert first_span["model"] == "gpt-3.5-turbo"
        assert first_span["params"] == {"temperature": 1, "stream": True}
        assert first_span["timestamps"]["started_at"] == int(
            datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
        )
        assert first_span["timestamps"]["first_token_at"] >= int(
            datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
        )
        assert first_span["timestamps"]["finished_at"] >= int(
            datetime(2022, 1, 1, 0, 0, 30).timestamp() * 1000
        )

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_streams_with_functions(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_response(
            stream=create_openai_chat_completion_function_stream_mock(
                {"name": "Calculator", "arguments": '{\n  "input": "2+2"\n}'}
            ),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAIChatCompletionTracer(client):
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": "how much is 2 + 2?"}],
                stream=True,
                functions=[
                    {
                        "name": "Calculator",
                        "description": "useful for when you need to answer questions about math",
                        "parameters": {
                            "properties": {
                                "expression": {
                                    "title": "expression",
                                    "type": "string",
                                }
                            },
                            "required": ["expression"],
                            "type": "object",
                        },
                    }
                ],
            )
            for _ in response:
                pass  # just to consume the stream

        time.sleep(0.01)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["outputs"] == [
            {
                "type": "chat_messages",
                "value": [
                    {
                        "role": "assistant",
                        "function_call": {
                            "arguments": '{\n  "input": "2+2"\n}',
                            "name": "Calculator",
                        },
                        "content": None,
                    }
                ],
            }
        ]

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_tool_calls(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        openai_mocks = [
            {
                "id": "chatcmpl-8Sf6QZXVnDyjAIQcmjcRiYeMKY49D",
                "object": "chat.completion",
                "created": 1701841874,
                "model": "gpt-3.5-turbo-0613",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_hF48nuhUAwKVFQ3JZKdcSDZU",
                                    "type": "function",
                                    "function": {
                                        "name": "get_current_weather",
                                        "arguments": '{\n  "location": "Boston"\n}',
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {
                    "prompt_tokens": 82,
                    "completion_tokens": 16,
                    "total_tokens": 98,
                },
                "system_fingerprint": None,
            }
        ]
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(openai_mocks),
            url="https://api.openai.com/v1/chat/completions",
        )

        tools: List[ChatCompletionToolParam] = [
            {
                "type": "function",
                "function": {
                    "name": "get_current_weather",
                    "description": "Get the current weather in a given location",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {
                                "type": "string",
                                "description": "The city and state, e.g. San Francisco, CA",
                            },
                            "unit": {
                                "type": "string",
                                "enum": ["celsius", "fahrenheit"],
                            },
                        },
                        "required": ["location"],
                    },
                },
            }
        ]
        with langwatch.openai.OpenAIChatCompletionTracer(client):
            client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "user", "content": "What is the weather like in Boston?"}
                ],
                tools=tools,
                tool_choice="auto",
            )

        time.sleep(0.01)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["params"]["tools"] == tools
        assert first_span["params"]["tool_choice"] == "auto"
        assert first_span["outputs"] == [
            {
                "type": "chat_messages",
                "value": [
                    {
                        "role": "assistant",
                        "content": None,
                        "function_call": None,
                        "tool_calls": [
                            {
                                "id": "call_hF48nuhUAwKVFQ3JZKdcSDZU",
                                "type": "function",
                                "function": {
                                    "name": "get_current_weather",
                                    "arguments": '{\n  "location": "Boston"\n}',
                                },
                            }
                        ],
                    }
                ],
            }
        ]

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_streams_with_tools(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_response(
            stream=IteratorStream(
                [
                    str.encode(line + "\n\n")
                    for line in """data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_oTTUQg7fmAiF6MlGyQ2yLrh1","type":"function","function":{"name":"get_current_weather","arguments":""}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\n"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\""}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"location"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\":"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":" \\""}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Boston"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":","}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":" MA"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"\\n"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-8Sf3okV8aZ95sKdzYJA9bVIU8aVts","object":"chat.completion.chunk","created":1701841712,"model":"gpt-3.5-turbo-0613","system_fingerprint":null,"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]""".split(
                        "\n\n"
                    )
                ]
            ),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAIChatCompletionTracer(client):
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "user", "content": "What is the weather like in Boston?"}
                ],
                stream=True,
                tools=[
                    {
                        "type": "function",
                        "function": {
                            "name": "get_current_weather",
                            "description": "Get the current weather in a given location",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "location": {
                                        "type": "string",
                                        "description": "The city and state, e.g. San Francisco, CA",
                                    },
                                    "unit": {
                                        "type": "string",
                                        "enum": ["celsius", "fahrenheit"],
                                    },
                                },
                                "required": ["location"],
                            },
                        },
                    }
                ],
                tool_choice="auto",
            )
            for _ in response:
                pass  # just to consume the stream

        time.sleep(0.01)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["outputs"] == [
            {
                "type": "chat_messages",
                "value": [
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_oTTUQg7fmAiF6MlGyQ2yLrh1",
                                "type": "function",
                                "function": {
                                    "name": "get_current_weather",
                                    "arguments": '{\n"location": "Boston, MA"\n}',
                                },
                            }
                        ],
                    }
                ],
            }
        ]

    @pytest.mark.asyncio
    async def test_trace_session_captures_openai_async_streams(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_response(
            stream=create_openai_chat_completion_stream_mock(
                ["Hi", " there", " all", " good?"], ["Hi", " how", " are", " you"]
            ),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAIChatCompletionTracer(async_client):
            response = await async_client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": "Hello!"}],
                stream=True,
                n=2,
            )
            texts = []
            async for chunk in response:
                texts.append(chunk.choices[0].delta.content)
            assert texts == [
                "",
                "",
                "Hi",
                " there",
                " all",
                " good?",
                "Hi",
                " how",
                " are",
                " you",
                None,
                None,
            ]

        time.sleep(0.01)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        assert first_span["outputs"] == [
            {
                "type": "chat_messages",
                "value": [{"role": "assistant", "content": "Hi there all good?"}],
            },
            {
                "type": "chat_messages",
                "value": [{"role": "assistant", "content": "Hi how are you"}],
            },
        ]
        assert first_span["model"] == "gpt-3.5-turbo"
        assert first_span["params"] == {"temperature": 1, "stream": True}

    def test_trace_rag(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        openai_mocks = [
            create_openai_chat_completion_mock("The capital of France is Paris."),
        ]
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(openai_mocks),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAIChatCompletionTracer(client):
            with langwatch.capture_rag(
                input="What is the capital of France?",
                contexts=[
                    {
                        "document_id": "doc-1",
                        "chunk_id": "0",
                        "content": "France is a country in Europe.",
                    },
                    {
                        "document_id": "doc-2",
                        "chunk_id": "0",
                        "content": "Paris is the capital of France.",
                    },
                ],
            ):
                response = client.chat.completions.create(
                    model="gpt-3.5-turbo",
                    messages=[
                        {"role": "user", "content": "What is the capital of France?"}
                    ],
                )

        time.sleep(0.01)

        llm_span, rag_span = requests_mock.request_history[0].json()["spans"]

        assert rag_span["type"] == "rag"
        assert rag_span["input"]["value"] == "What is the capital of France?"
        assert rag_span["contexts"] == [
            {
                "document_id": "doc-1",
                "chunk_id": "0",
                "content": "France is a country in Europe.",
            },
            {
                "document_id": "doc-2",
                "chunk_id": "0",
                "content": "Paris is the capital of France.",
            },
        ]

        assert llm_span["type"] == "llm"
        assert (
            llm_span["outputs"][0]["value"][0]["content"]
            == response.choices[0].message.content
        )


class TestOpenAITracer:
    def test_traces_both_completion_and_chat_completion(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint + "/api/collector", json={})
        httpx_mock.add_callback(
            one_mock_at_a_time([create_openai_completion_mock("foo")]),
            url="https://api.openai.com/v1/completions",
        )
        httpx_mock.add_callback(
            one_mock_at_a_time([create_openai_chat_completion_mock("bar")]),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAITracer(
            client,
            metadata={
                "user_id": "user-123",
                "thread_id": "thread-456",
                "customer_id": "customer-789",
            },
        ):
            client.completions.create(
                model="gpt-3.5-turbo-instruct", prompt="Hello Completion!"
            )
            client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": "Hello ChatCompletion!"}],
            )

        time.sleep(0.01)
        first_span = requests_mock.request_history[0].json()["spans"][0]
        second_span = requests_mock.request_history[1].json()["spans"][0]
        assert first_span["trace_id"] == second_span["trace_id"]
