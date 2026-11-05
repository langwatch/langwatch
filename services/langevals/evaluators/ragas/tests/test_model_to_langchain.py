"""The litellm client has to satisfy the shape langchain-openai calls it with.

langchain-openai routes the non-streaming path through
`client.with_raw_response.create(...)` followed by `.parse()`, rather than
calling `client.create(...)` directly as it once did. These tests pin that shape
so a future bump cannot quietly reintroduce the AttributeError.
"""

import asyncio
from unittest.mock import patch

import litellm
from litellm.types.utils import Choices, Message, ModelResponse

from langevals_ragas.lib.model_to_langchain import (
    AsyncLitellmCompletion,
    LitellmCompletion,
    model_to_langchain,
)


def _canned_response(content: str = "pong") -> ModelResponse:
    return ModelResponse(
        id="chatcmpl-test",
        created=0,
        model="gpt-4o-mini",
        object="chat.completion",
        choices=[
            Choices(
                finish_reason="stop",
                index=0,
                message=Message(role="assistant", content=content),
            )
        ],
    )


def test_with_raw_response_wraps_the_completion(monkeypatch):
    monkeypatch.setattr(
        litellm, "completion", lambda *args, **kwargs: {"choices": [], "kw": kwargs}
    )

    raw = LitellmCompletion(temperature=0.5).with_raw_response.create(
        model="gpt-5-mini", messages=[]
    )

    assert raw.headers == {}
    assert raw.parse()["kw"]["temperature"] == 0.5
    assert raw.parse()["kw"]["drop_params"] is True


def test_async_with_raw_response_wraps_the_completion(monkeypatch):
    monkeypatch.setattr(
        litellm, "completion", lambda *args, **kwargs: {"choices": [], "kw": kwargs}
    )

    raw = asyncio.run(
        AsyncLitellmCompletion(
            extra_call_kwargs={"api_version": "2024-06-01"}
        ).with_raw_response.create(model="gpt-5-mini", messages=[])
    )

    assert raw.headers == {}
    assert raw.parse()["kw"]["api_version"] == "2024-06-01"


def test_client_exposes_with_raw_response():
    llm = model_to_langchain("gpt-4o-mini")
    assert hasattr(llm.client, "with_raw_response")
    assert hasattr(llm.async_client, "with_raw_response")


def test_invoke_routes_through_with_raw_response():
    llm = model_to_langchain("gpt-4o-mini")
    with patch("litellm.completion", return_value=_canned_response()) as completion:
        result = llm.invoke("ping")
    assert result.content == "pong"
    assert completion.call_count == 1


def test_ainvoke_routes_through_with_raw_response():
    llm = model_to_langchain("gpt-4o-mini")

    async def go():
        with patch("litellm.completion", return_value=_canned_response("async pong")):
            return await llm.ainvoke("ping")

    assert asyncio.run(go()).content == "async pong"


def test_raw_response_parse_returns_the_litellm_response():
    llm = model_to_langchain("gpt-4o-mini")
    canned = _canned_response()
    with patch("litellm.completion", return_value=canned):
        raw = llm.client.with_raw_response.create(model="gpt-4o-mini", messages=[])
    assert raw.parse() is canned
    assert raw.headers == {}
