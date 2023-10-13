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


def create_openai_chat_completion_function_stream_mock(*function_calls):
    for index, function_call in enumerate(function_calls):
        yield create_openai_chat_completion_chunk(
            index,
            {
                "role": "assistant",
                "content": None,
                "function_call": {"name": function_call["name"], "arguments": ""},
            },
        )
    for index, function_call in enumerate(function_calls):
        for token_index, token in enumerate(function_call["arguments"].split(" ")):
            yield create_openai_chat_completion_chunk(
                index,
                {"function_call": {"arguments": ("" if token_index == 0 else " ") + token}},
            )
    for index in range(0, len(function_calls)):
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
