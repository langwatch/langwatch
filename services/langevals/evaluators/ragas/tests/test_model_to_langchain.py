import asyncio

import litellm

from langevals_ragas.lib.model_to_langchain import (
    AsyncLitellmCompletion,
    LitellmCompletion,
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
