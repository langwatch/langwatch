import asyncio
from datetime import datetime
import time
from freezegun import freeze_time
from unittest.mock import patch
import pytest
import openai
import langwatch
import requests_mock


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

            time.sleep(0.1)
            first_step = mock_request.request_history[0].json()["steps"][0]
            assert first_step["trace_id"].startswith("trace_")
            assert first_step["model"] == "openai/gpt-3.5-turbo-instruct"
            assert first_step["input"] == {"type": "text", "value": "hi"}
            assert first_step["outputs"] == [
                {
                    "type": "text",
                    "value": " there",
                }
            ]
            assert first_step["raw_response"] == openai_mocks[0]
            assert first_step["params"] == {"temperature": 1, "stream": False}
            assert first_step["metrics"] == {
                "prompt_tokens": 5,
                "completion_tokens": 16,
            }
            assert first_step["timestamps"]["requested_at"] == int(
                datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
            )
            assert first_step["timestamps"]["finished_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )

            second_step = mock_request.request_history[0].json()["steps"][1]
            assert second_step["trace_id"] == first_step["trace_id"]

            with langwatch.openai.OpenAICompletionTracer():
                openai.Completion.create(
                    model="gpt-3.5-turbo-instruct", prompt="we will we will rock"
                )
                openai.Completion.create(
                    model="gpt-3.5-turbo-instruct", prompt="heey hey baby uh"
                )

            time.sleep(0.1)
            third_step = mock_request.request_history[1].json()["steps"][0]
            assert third_step["trace_id"] != first_step["trace_id"]

            fourth_step = mock_request.request_history[1].json()["steps"][1]
            assert fourth_step["trace_id"] == third_step["trace_id"]

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

            time.sleep(0.1)
            traced = mock_request.request_history[0].json()["steps"][0]
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
            first_step = mock_request.request_history[0].json()["steps"][0]
            assert first_step["outputs"] == [
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

            time.sleep(1)
            first_step = mock_request.request_history[0].json()["steps"][0]
            assert first_step["outputs"] == [
                {
                    "type": "text",
                    "value": " there all good?",
                },
                {
                    "type": "text",
                    "value": " how are you",
                },
            ]
            assert first_step["model"] == "openai/gpt-3.5-turbo-instruct"
            assert first_step["params"] == {"temperature": 1, "stream": True}
            assert first_step["timestamps"]["requested_at"] == int(
                datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
            )
            assert first_step["timestamps"]["first_token_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )
            assert first_step["timestamps"]["finished_at"] == int(
                datetime(2022, 1, 1, 0, 0, 30).timestamp() * 1000
            )
            assert first_step["raw_response"] == [
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

            time.sleep(1)
            first_step = mock_request.request_history[0].json()["steps"][0]
            assert first_step["outputs"] == [
                {
                    "type": "text",
                    "value": " there all good?",
                },
                {
                    "type": "text",
                    "value": " how are you",
                },
            ]
            assert first_step["model"] == "openai/gpt-3.5-turbo-instruct"
            assert first_step["params"] == {"temperature": 1, "stream": True}


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

            time.sleep(0.1)
            first_step = mock_request.request_history[0].json()["steps"][0]
            assert first_step["trace_id"].startswith("trace_")
            assert first_step["model"] == "openai/gpt-3.5-turbo"
            assert first_step["input"] == {
                "type": "chat_messages",
                "value": [{"role": "user", "content": "Hello!"}],
            }
            assert first_step["outputs"] == [
                {
                    "type": "chat_messages",
                    "value": [{"role": "assistant", "content": "hi there!"}],
                }
            ]
            assert first_step["raw_response"] == openai_mocks[0]
            assert first_step["params"] == {"temperature": 1, "stream": False}
            assert first_step["metrics"] == {
                "prompt_tokens": 5,
                "completion_tokens": 16,
            }
            assert first_step["timestamps"]["requested_at"] == int(
                datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
            )
            assert first_step["timestamps"]["finished_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )

            second_step = mock_request.request_history[0].json()["steps"][1]
            assert second_step["trace_id"] == first_step["trace_id"]

    def test_trace_session_captures_exceptions(self):
        with patch.object(
            openai.ChatCompletion, "create", side_effect=Exception("An error occurred!")
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

            with pytest.raises(Exception) as err:
                with langwatch.openai.OpenAIChatCompletionTracer():
                    openai.ChatCompletion.create(model="gpt-3.5-turbo", messages=[])
            assert str(err.value) == "An error occurred!"

            time.sleep(0.1)
            traced = mock_request.request_history[0].json()["steps"][0]
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
            first_step = mock_request.request_history[0].json()["steps"][0]
            assert first_step["outputs"] == [
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

            time.sleep(1)
            first_step = mock_request.request_history[0].json()["steps"][0]
            assert first_step["outputs"] == [
                {
                    "type": "chat_messages",
                    "value": [{"role": "assistant", "content": "Hi there all good?"}],
                },
                {
                    "type": "chat_messages",
                    "value": [{"role": "assistant", "content": "Hi how are you"}],
                },
            ]
            assert first_step["model"] == "openai/gpt-3.5-turbo"
            assert first_step["params"] == {"temperature": 1, "stream": True}
            assert first_step["timestamps"]["requested_at"] == int(
                datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
            )
            assert first_step["timestamps"]["first_token_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )
            assert first_step["timestamps"]["finished_at"] == int(
                datetime(2022, 1, 1, 0, 0, 30).timestamp() * 1000
            )
            assert first_step["raw_response"] == [
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

            time.sleep(1)
            first_step = mock_request.request_history[0].json()["steps"][0]
            assert first_step["outputs"] == [
                {
                    "type": "chat_messages",
                    "value": [{"role": "assistant", "content": "Hi there all good?"}],
                },
                {
                    "type": "chat_messages",
                    "value": [{"role": "assistant", "content": "Hi how are you"}],
                },
            ]
            assert first_step["model"] == "openai/gpt-3.5-turbo"
            assert first_step["params"] == {"temperature": 1, "stream": True}


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

            time.sleep(0.1)
            first_step = mock_request.request_history[0].json()["steps"][0]
            second_step = mock_request.request_history[1].json()["steps"][0]
            assert first_step["trace_id"] == second_step["trace_id"]


def create_openai_completion_mock(text):
    return {
        "id": "cmpl-861BvC6rh12Y1hrk8ml1BaQPJP0mE",
        "object": "text_completion",
        "created": 1696445239,
        "model": "gpt-3.5-turbo-instruct",
        "choices": [
            {
                "text": text,
                "index": 0,
                "logprobs": None,
                "finish_reason": "length",
            }
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 16, "total_tokens": 21},
    }


def create_openai_completion_stream_mock(*text_groups):
    for index, texts in enumerate(text_groups):
        for text in texts:
            yield create_openai_completion_chunk(index, text)


async def create_openai_completion_async_stream_mock(*text_groups):
    for index, texts in enumerate(text_groups):
        for text in texts:
            yield create_openai_completion_chunk(index, text)


def create_openai_completion_chunk(index: int, text: str):
    return {
        "id": "cmpl-86MtN6iz0JSSIiLAesNKKqyDtKcZO",
        "object": "text_completion",
        "created": 1696528657,
        "choices": [
            {"text": text, "index": index, "logprobs": None, "finish_reason": "length"}
        ],
        "model": "gpt-3.5-turbo-instruct",
    }


def create_openai_chat_completion_mock(text):
    return {
        "id": "chatcmpl-86zIvz53Wa4qTc1ksUt3coF5yTvm7",
        "object": "chat.completion",
        "created": 1696676313,
        "model": "gpt-3.5-turbo-0613",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": text,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 16, "total_tokens": 21},
    }


def create_openai_chat_completion_stream_mock(*text_groups):
    for index in range(0, len(text_groups)):
        yield create_openai_chat_completion_chunk(
            index, {"role": "assistant", "content": ""}
        )
    for index, texts in enumerate(text_groups):
        for text in texts:
            yield create_openai_chat_completion_chunk(index, {"content": text})
    for index in range(0, len(text_groups)):
        yield create_openai_chat_completion_chunk(index, {})


async def create_openai_chat_completion_async_stream_mock(*text_groups):
    for index in range(0, len(text_groups)):
        yield create_openai_chat_completion_chunk(
            index, {"role": "assistant", "content": ""}
        )
    for index, texts in enumerate(text_groups):
        for text in texts:
            yield create_openai_chat_completion_chunk(index, {"content": text})
    for index in range(0, len(text_groups)):
        yield create_openai_chat_completion_chunk(index, {})


def create_openai_chat_completion_chunk(index: int, delta: dict):
    return {
        "id": "chatcmpl-871IjS1cTmejs3MVHu3zJseODF5KU",
        "object": "chat.completion.chunk",
        "created": 1696683989,
        "model": "gpt-3.5-turbo-0613",
        "choices": [{"index": index, "delta": delta, "finish_reason": None}],
    }
