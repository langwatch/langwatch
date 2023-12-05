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

from tests.utils import *
from pytest_httpx import HTTPXMock

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
        requests_mock.post(langwatch.endpoint, json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(openai_mocks),
            url="https://api.openai.com/v1/completions",
        )

        with langwatch.openai.OpenAICompletionTracer(
            client, user_id="user-123", thread_id="thread-456"
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

        assert trace_request["user_id"] == "user-123"
        assert trace_request["thread_id"] == "thread-456"

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
        assert first_span["raw_response"] == openai_mocks[0]
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
            requests_mock.post(langwatch.endpoint, json={})

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
        requests_mock.post(langwatch.endpoint, json={})
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
        requests_mock.post(langwatch.endpoint, json={})
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
        assert first_span["raw_response"] == [
            create_openai_completion_chunk(0, " there"),
            create_openai_completion_chunk(0, " all"),
            create_openai_completion_chunk(0, " good?"),
            create_openai_completion_chunk(1, " how"),
            create_openai_completion_chunk(1, " are"),
            create_openai_completion_chunk(1, " you"),
        ]

    @pytest.mark.asyncio
    async def test_trace_session_captures_openai_async_streams(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint, json={})
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
        requests_mock.post(langwatch.endpoint, json={})
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
        assert first_span["id"].startswith("span_")
        assert first_span["parent_id"] == None

        assert fourth_span["type"] == "span"
        assert fourth_span["name"] == "subtask"
        assert fourth_span["trace_id"] == first_span["trace_id"]
        assert fourth_span["id"].startswith("span_")
        assert fourth_span["parent_id"] == None

        assert second_span["type"] == "llm"
        assert second_span["trace_id"] == first_span["trace_id"]
        assert second_span["parent_id"] == fourth_span["id"]

        assert third_span["type"] == "llm"
        assert third_span["trace_id"] == first_span["trace_id"]
        assert third_span["parent_id"] == fourth_span["id"]

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_nested_spans_using_annotations(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint, json={})
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
        assert first_span["id"].startswith("span_")
        assert first_span["parent_id"] == None

        assert fourth_span["type"] == "span"
        assert fourth_span["name"] == "subtask"
        assert fourth_span["input"] == {"type": "json", "value": {"foo": "bar"}}
        assert fourth_span["outputs"] == [{"type": "text", "value": "bar"}]
        assert fourth_span["trace_id"] == first_span["trace_id"]
        assert fourth_span["id"].startswith("span_")
        assert fourth_span["parent_id"] == None

        assert second_span["type"] == "llm"
        assert second_span["trace_id"] == first_span["trace_id"]
        assert second_span["parent_id"] == fourth_span["id"]

        assert third_span["type"] == "llm"
        assert third_span["trace_id"] == first_span["trace_id"]
        assert third_span["parent_id"] == fourth_span["id"]


class TestOpenAIChatCompletionTracer:
    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_calls(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        openai_mocks = [
            create_openai_chat_completion_mock("hi there!"),
            create_openai_chat_completion_mock("bar baz"),
        ]
        requests_mock.post(langwatch.endpoint, json={})
        httpx_mock.add_callback(
            one_mock_at_a_time(openai_mocks),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAIChatCompletionTracer(client):
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
        first_span = requests_mock.request_history[0].json()["spans"][0]
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
        assert first_span["raw_response"] == openai_mocks[0]
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
            requests_mock.post(langwatch.endpoint, json={})

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
        requests_mock.post(langwatch.endpoint, json={})
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
        requests_mock.post(langwatch.endpoint, json={})
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
        requests_mock.post(langwatch.endpoint, json={})
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
        assert first_span["raw_response"] == [
            create_openai_chat_completion_chunk(
                0, {"role": "assistant", "content": ""}
            ),
            create_openai_chat_completion_chunk(
                1, {"role": "assistant", "content": ""}
            ),
            create_openai_chat_completion_chunk(0, {"content": "Hi"}),
            create_openai_chat_completion_chunk(0, {"content": " there"}),
            create_openai_chat_completion_chunk(0, {"content": " all"}),
            create_openai_chat_completion_chunk(0, {"content": " good?"}),
            create_openai_chat_completion_chunk(1, {"content": "Hi"}),
            create_openai_chat_completion_chunk(1, {"content": " how"}),
            create_openai_chat_completion_chunk(1, {"content": " are"}),
            create_openai_chat_completion_chunk(1, {"content": " you"}),
            create_openai_chat_completion_chunk(0, {}),
            create_openai_chat_completion_chunk(1, {}),
        ]

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_streams_with_functions(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint, json={})
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

    @pytest.mark.asyncio
    async def test_trace_session_captures_openai_async_streams(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint, json={})
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


class TestOpenAITracer:
    def test_traces_both_completion_and_chat_completion(
        self, httpx_mock: HTTPXMock, requests_mock: requests_mock.Mocker
    ):
        requests_mock.post(langwatch.endpoint, json={})
        httpx_mock.add_callback(
            one_mock_at_a_time([create_openai_completion_mock("foo")]),
            url="https://api.openai.com/v1/completions",
        )
        httpx_mock.add_callback(
            one_mock_at_a_time([create_openai_chat_completion_mock("bar")]),
            url="https://api.openai.com/v1/chat/completions",
        )

        with langwatch.openai.OpenAITracer(
            client, user_id="user-123", thread_id="thread-456"
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
