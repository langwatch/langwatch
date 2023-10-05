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

        with langwatch.openai.trace():
            openai.Completion.create(model="babbage-002", prompt="hi")
            openai.Completion.create(model="babbage-002", prompt="foo")

        time.sleep(0.1)
        first_step = mock_request.request_history[0].json()["steps"][0]
        assert first_step["trace_id"].startswith("trace_")
        assert first_step["model"] == "openai/babbage-002"
        assert first_step["input"] == {"type": "text", "value": "hi"}
        assert first_step["outputs"] == [
            {
                "type": "text",
                "value": " there",
            }
        ]
        assert first_step["raw_response"] == create_openai_completion_mock(
            " there"
        )
        assert first_step["params"] == {"temperature": 1}
        assert first_step["metrics"] == {
            "prompt_tokens": 5,
            "completion_tokens": 16,
        }
        # TODO: timing metrics
        assert first_step["requested_at"] == int(
            datetime(2022, 1, 1, 0, 0).timestamp()
        )

        second_step = mock_request.request_history[0].json()["steps"][1]
        assert second_step["trace_id"] == first_step["trace_id"]

        with langwatch.openai.trace():
            openai.Completion.create(model="babbage-002", prompt="we will we will rock")
            openai.Completion.create(model="babbage-002", prompt="heey hey baby uh")

        time.sleep(0.1)
        third_step = mock_request.request_history[1].json()["steps"][0]
        assert third_step["trace_id"] != first_step["trace_id"]

        fourth_step = mock_request.request_history[1].json()["steps"][1]
        assert fourth_step["trace_id"] == third_step["trace_id"]


def create_openai_completion_mock(text):
    return {
        "id": "cmpl-861BvC6rh12Y1hrk8ml1BaQPJP0mE",
        "object": "text_completion",
        "created": 1696445239,
        "model": "babbage-002",
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
