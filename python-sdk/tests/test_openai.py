import asyncio
from datetime import datetime
import json
import time
from freezegun import freeze_time
from unittest.mock import patch
import pytest
import openai
import langwatch
import langwatch.openai
import requests_mock

from tests.utils import *


class TestOpenAICompletionTracer:
    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_calls(self):
        openai_mocks = [
            create_openai_completion_mock(" there"),
            create_openai_completion_mock(" bar"),
            create_openai_completion_mock(" you!"),
            create_openai_completion_mock(" ah!"),
        ]
        with patch.object(
            openai.Completion,
            "create",
            side_effect=openai_mocks,
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with langwatch.openai.OpenAICompletionTracer():
                response = openai.Completion.create(
                    model="gpt-3.5-turbo-instruct", prompt="hi"
                )
                assert response == openai_mocks[0]
                response = openai.Completion.create(
                    model="gpt-3.5-turbo-instruct", prompt="foo"
                )
                assert response == openai_mocks[1]

            time.sleep(0.01)
            first_span = mock_request.request_history[0].json()["spans"][0]
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
            assert first_span["timestamps"]["finished_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )

            second_span = mock_request.request_history[0].json()["spans"][1]
            assert second_span["trace_id"] == first_span["trace_id"]

            with langwatch.openai.OpenAICompletionTracer():
                openai.Completion.create(
                    model="gpt-3.5-turbo-instruct", prompt="we will we will rock"
                )
                openai.Completion.create(
                    model="gpt-3.5-turbo-instruct", prompt="heey hey baby uh"
                )

            time.sleep(0.01)
            third_span = mock_request.request_history[1].json()["spans"][0]
            assert third_span["trace_id"] != first_span["trace_id"]

            fourth_span = mock_request.request_history[1].json()["spans"][1]
            assert fourth_span["trace_id"] == third_span["trace_id"]

    def test_trace_session_captures_exceptions(self):
        with patch.object(
            openai.Completion, "create", side_effect=Exception("An error occurred!")
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with pytest.raises(Exception) as err:
                with langwatch.openai.OpenAICompletionTracer():
                    openai.Completion.create(
                        model="gpt-3.5-turbo-instruct", prompt="hi"
                    )
            assert str(err.value) == "An error occurred!"

            time.sleep(0.01)
            traced = mock_request.request_history[0].json()["spans"][0]
            assert traced["error"]["message"] == "An error occurred!"
            assert len(traced["error"]["stacktrace"]) > 0

    @pytest.mark.asyncio
    async def test_trace_session_captures_openai_async_calls(self):
        openai_mocks = [
            create_openai_completion_mock(" there"),
        ]
        with patch.object(
            openai.Completion,
            "acreate",
            side_effect=openai_mocks,
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with langwatch.openai.OpenAICompletionTracer():
                response = await openai.Completion.acreate(
                    model="gpt-3.5-turbo-instruct", prompt="hi"
                )
                assert response == openai_mocks[0]

            await asyncio.sleep(0.1)
            first_span = mock_request.request_history[0].json()["spans"][0]
            assert first_span["outputs"] == [
                {
                    "type": "text",
                    "value": " there",
                }
            ]

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_streams(self):
        with patch.object(
            openai.Completion,
            "create",
            side_effect=[
                create_openai_completion_stream_mock(
                    [" there", " all", " good?"], [" how", " are", " you"]
                ),
            ],
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with langwatch.openai.OpenAICompletionTracer():
                response = openai.Completion.create(
                    model="gpt-3.5-turbo-instruct", prompt="hi", stream=True, n=2
                )
                texts = []
                for chunk in response:
                    texts.append(chunk.get("choices")[0].get("text"))  # type: ignore
                assert texts == [" there", " all", " good?", " how", " are", " you"]

            time.sleep(0.01)
            first_span = mock_request.request_history[0].json()["spans"][0]
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
            assert first_span["timestamps"]["first_token_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )
            assert first_span["timestamps"]["finished_at"] == int(
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
    async def test_trace_session_captures_openai_async_streams(self):
        with patch.object(
            openai.Completion,
            "acreate",
            side_effect=[
                create_openai_completion_async_stream_mock(
                    [" there", " all", " good?"], [" how", " are", " you"]
                ),
            ],
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with langwatch.openai.OpenAICompletionTracer():
                response = await openai.Completion.acreate(
                    model="gpt-3.5-turbo-instruct", prompt="hi", stream=True, n=2
                )
                texts = []
                async for chunk in response:  # type: ignore
                    texts.append(chunk.get("choices")[0].get("text"))  # type: ignore
                assert texts == [" there", " all", " good?", " how", " are", " you"]

            time.sleep(0.01)
            first_span = mock_request.request_history[0].json()["spans"][0]
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
    def test_trace_nested_spans(self):
        with patch.object(
            openai.Completion,
            "create",
            side_effect=[
                create_openai_completion_mock(" there"),
                create_openai_completion_mock(" are"),
                create_openai_completion_mock("?"),
            ],
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with langwatch.openai.OpenAICompletionTracer():
                openai.Completion.create(model="gpt-3.5-turbo-instruct", prompt="hi")
                with langwatch.span("subtask"):
                    openai.Completion.create(
                        model="gpt-3.5-turbo-instruct", prompt="how"
                    )
                    openai.Completion.create(
                        model="gpt-3.5-turbo-instruct", prompt="you"
                    )

            time.sleep(0.01)

            (
                first_span,
                second_span,
                third_span,
                fourth_span,
            ) = mock_request.request_history[0].json()["spans"]

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


class TestOpenAIChatCompletionTracer:
    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_calls(self):
        openai_mocks = [
            create_openai_chat_completion_mock("hi there!"),
            create_openai_chat_completion_mock("bar baz"),
        ]
        with patch.object(
            openai.ChatCompletion,
            "create",
            side_effect=openai_mocks,
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with langwatch.openai.OpenAIChatCompletionTracer():
                response = openai.ChatCompletion.create(
                    model="gpt-3.5-turbo",
                    messages=[{"role": "user", "content": "Hello!"}],
                )
                assert response == openai_mocks[0]
                response = openai.ChatCompletion.create(
                    model="gpt-3.5-turbo",
                    messages=[{"role": "user", "content": "foo"}],
                )
                assert response == openai_mocks[1]

            time.sleep(0.01)
            first_span = mock_request.request_history[0].json()["spans"][0]
            assert first_span["trace_id"].startswith("trace_")
            assert first_span["vendor"] == "openai"
            assert first_span["model"] == "gpt-3.5-turbo"
            assert first_span["input"] == {
                "type": "chat_messages",
                "value": [{"role": "user", "content": "Hello!"}],
            }
            assert first_span["outputs"] == [
                {
                    "type": "chat_messages",
                    "value": [{"role": "assistant", "content": "hi there!"}],
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
            assert first_span["timestamps"]["finished_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )

            second_span = mock_request.request_history[0].json()["spans"][1]
            assert second_span["trace_id"] == first_span["trace_id"]

    def test_trace_session_captures_exceptions(self):
        with patch.object(
            openai.ChatCompletion, "create", side_effect=Exception("An error occurred!")
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with pytest.raises(Exception) as err:
                with langwatch.openai.OpenAIChatCompletionTracer():
                    openai.ChatCompletion.create(model="gpt-3.5-turbo", messages=[])
            assert str(err.value) == "An error occurred!"

            time.sleep(0.01)
            traced = mock_request.request_history[0].json()["spans"][0]
            assert traced["error"]["message"] == "An error occurred!"
            assert len(traced["error"]["stacktrace"]) > 0

    @pytest.mark.asyncio
    async def test_trace_session_captures_openai_async_calls(self):
        openai_mocks = [
            create_openai_chat_completion_mock("hi there!"),
        ]
        with patch.object(
            openai.ChatCompletion,
            "acreate",
            side_effect=openai_mocks,
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with langwatch.openai.OpenAIChatCompletionTracer():
                response = await openai.ChatCompletion.acreate(
                    model="gpt-3.5-turbo",
                    messages=[{"role": "user", "content": "Hello!"}],
                )
                assert response == openai_mocks[0]

            await asyncio.sleep(0.1)
            first_span = mock_request.request_history[0].json()["spans"][0]
            assert first_span["outputs"] == [
                {
                    "type": "chat_messages",
                    "value": [{"role": "assistant", "content": "hi there!"}],
                }
            ]

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_session_captures_openai_streams(self):
        with patch.object(
            openai.ChatCompletion,
            "create",
            side_effect=[
                create_openai_chat_completion_stream_mock(
                    ["Hi", " there", " all", " good?"], ["Hi", " how", " are", " you"]
                ),
            ],
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with langwatch.openai.OpenAIChatCompletionTracer():
                response = openai.ChatCompletion.create(
                    model="gpt-3.5-turbo",
                    messages=[{"role": "user", "content": "Hello!"}],
                    stream=True,
                    n=2,
                )
                texts = []
                for chunk in response:
                    texts.append(chunk.get("choices")[0].get("delta").get("content"))  # type: ignore
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
            first_span = mock_request.request_history[0].json()["spans"][0]
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
            assert first_span["timestamps"]["first_token_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )
            assert first_span["timestamps"]["finished_at"] == int(
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

    @pytest.mark.asyncio
    async def test_trace_session_captures_openai_async_streams(self):
        with patch.object(
            openai.ChatCompletion,
            "acreate",
            side_effect=[
                create_openai_chat_completion_async_stream_mock(
                    ["Hi", " there", " all", " good?"], ["Hi", " how", " are", " you"]
                ),
            ],
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with langwatch.openai.OpenAIChatCompletionTracer():
                response = await openai.ChatCompletion.acreate(
                    model="gpt-3.5-turbo",
                    messages=[{"role": "user", "content": "Hello!"}],
                    stream=True,
                    n=2,
                )
                texts = []
                async for chunk in response:  # type: ignore
                    texts.append(chunk.get("choices")[0].get("delta").get("content"))  # type: ignore
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
            first_span = mock_request.request_history[0].json()["spans"][0]
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
    def test_traces_both_completion_and_chat_completion(self):
        with patch.object(
            openai.Completion,
            "create",
            side_effect=[create_openai_completion_mock("foo")],
        ), patch.object(
            openai.ChatCompletion,
            "create",
            side_effect=[create_openai_chat_completion_mock("bar")],
        ), requests_mock.Mocker() as mock_request:
            with langwatch.openai.OpenAITracer():
                openai.Completion.create(
                    model="gpt-3.5-turbo-instruct", prompt="Hello Completion!"
                )
                openai.ChatCompletion.create(
                    model="gpt-3.5-turbo",
                    messages=[{"role": "user", "content": "Hello ChatCompletion!"}],
                )

            time.sleep(0.01)
            first_span = mock_request.request_history[0].json()["spans"][0]
            second_span = mock_request.request_history[1].json()["spans"][0]
            assert first_span["trace_id"] == second_span["trace_id"]
