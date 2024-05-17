import json
from typing import Any, List
import httpx
from pytest_httpx import IteratorStream


def one_mock_at_a_time(mocks: List[Any]):
    mock_index = 0

    def _one_mock_at_a_time(_request: httpx.Request):
        nonlocal mock_index
        response = httpx.Response(
            status_code=200,
            json=mocks[mock_index],
        )
        mock_index += 1
        return response

    return _one_mock_at_a_time


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
        "system_fingerprint": None,
        "usage": {"prompt_tokens": 5, "completion_tokens": 16, "total_tokens": 21},
    }


def create_openai_completion_stream_mock(*text_groups):
    return IteratorStream(
        [
            str.encode(
                "data: "
                + json.dumps(create_openai_completion_chunk(index, text))
                + "\n\n"
            )
            for index, texts in enumerate(text_groups)
            for text in texts
        ]
        + [str.encode("data: [DONE]")]
    )


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
        "system_fingerprint": None,
        "usage": None,
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
                "logprobs": None,
                "message": {
                    "role": "assistant",
                    "content": text,
                    "function_call": None,
                    "tool_calls": None,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 16, "total_tokens": 21},
        "system_fingerprint": None,
    }


def create_openai_chat_completion_stream_mock(*text_groups):
    list = []
    for index in range(0, len(text_groups)):
        list.append(
            create_openai_chat_completion_chunk(
                index, {"role": "assistant", "content": ""}
            )
        )
    for index, texts in enumerate(text_groups):
        for text in texts:
            list.append(create_openai_chat_completion_chunk(index, {"content": text}))
    for index in range(0, len(text_groups)):
        list.append(create_openai_chat_completion_chunk(index, {}))

    return IteratorStream(
        [str.encode("data: " + json.dumps(item) + "\n\n") for item in list]
        + [str.encode("data: [DONE]")]
    )


def create_openai_chat_completion_function_stream_mock(*function_calls):
    list = []
    for index, function_call in enumerate(function_calls):
        list.append(
            create_openai_chat_completion_chunk(
                index,
                {
                    "role": "assistant",
                    "content": None,
                    "function_call": {"name": function_call["name"], "arguments": ""},
                },
            )
        )
    for index, function_call in enumerate(function_calls):
        for token_index, token in enumerate(function_call["arguments"].split(" ")):
            list.append(
                create_openai_chat_completion_chunk(
                    index,
                    {
                        "function_call": {
                            "arguments": ("" if token_index == 0 else " ") + token
                        }
                    },
                )
            )
    for index in range(0, len(function_calls)):
        list.append(create_openai_chat_completion_chunk(index, {}))

    return IteratorStream(
        [str.encode("data: " + json.dumps(item) + "\n\n") for item in list]
        + [str.encode("data: [DONE]")]
    )


def create_openai_chat_completion_chunk(index: int, delta: dict):
    empty_delta = {
        "content": None,
        "function_call": None,
        "tool_calls": None,
        "role": None,
    }
    return {
        "id": "chatcmpl-871IjS1cTmejs3MVHu3zJseODF5KU",
        "object": "chat.completion.chunk",
        "created": 1696683989,
        "model": "gpt-3.5-turbo-0613",
        "choices": [
            {"index": index, "delta": empty_delta | delta, "finish_reason": None}
        ],
        "system_fingerprint": None,
    }
