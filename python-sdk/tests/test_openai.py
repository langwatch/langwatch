import asyncio
from datetime import datetime
import time
from freezegun import freeze_time
from unittest.mock import patch
import pytest
import openai
import langwatch
import requests_mock


@freeze_time("2022-01-01")
def test_trace_session_captures_openai_calls():
    with patch.object(
        openai.Completion,
        "create",
        side_effect=[
            create_openai_completion_mock(" there"),
            create_openai_completion_mock(" bar"),
            create_openai_completion_mock(" you!"),
            create_openai_completion_mock(" ah!"),
        ],
    ), requests_mock.Mocker() as mock_request:
        mock_request.post(langwatch.endpoint, json={})

        with langwatch.openai.OpenAICompletionTracer():
            openai.Completion.create(model="gpt-3.5-turbo-instruct", prompt="hi")
            openai.Completion.create(model="gpt-3.5-turbo-instruct", prompt="foo")

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
        assert first_step["raw_response"] == create_openai_completion_mock(" there")
        assert first_step["params"] == {"temperature": 1}
        assert first_step["metrics"] == {
            "prompt_tokens": 5,
            "completion_tokens": 16,
        }
        # TODO: timing metrics
        assert first_step["requested_at"] == int(datetime(2022, 1, 1, 0, 0).timestamp())

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


@pytest.mark.asyncio
async def test_trace_session_captures_openai_async_calls():
    with patch.object(
        openai.Completion,
        "acreate",
        side_effect=[
            create_openai_completion_mock(" there"),
        ],
    ), requests_mock.Mocker() as mock_request:
        mock_request.post(langwatch.endpoint, json={})

        with langwatch.openai.OpenAICompletionTracer():
            await openai.Completion.acreate(model="gpt-3.5-turbo-instruct", prompt="hi")

        await asyncio.sleep(0.1)
        first_step = mock_request.request_history[0].json()["steps"][0]
        assert first_step["outputs"] == [
            {
                "type": "text",
                "value": " there",
            }
        ]


def test_trace_session_captures_openai_streams():
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
            openai.Completion.create(
                model="gpt-3.5-turbo-instruct", prompt="hi", stream=True, n=2
            )

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


@pytest.mark.asyncio
async def test_trace_session_captures_openai_async_streams():
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
            await openai.Completion.acreate(
                model="gpt-3.5-turbo-instruct", prompt="hi", stream=True, n=2
            )

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

def create_openai_completion_chunk(index, text):
    return {
        "id": "cmpl-86MtN6iz0JSSIiLAesNKKqyDtKcZO",
        "object": "text_completion",
        "created": 1696528657,
        "choices": [
            {"text": text, "index": index, "logprobs": None, "finish_reason": "length"}
        ],
        "model": "gpt-3.5-turbo-instruct",
    }
