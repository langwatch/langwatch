import os
import dspy
import functools
import json
import logging
from typing import Any, Literal, Optional, cast

import backoff
import litellm
from litellm.utils import completion_cost
import openai

from dsp.modules.cache_utils import CacheMemory, NotebookCacheMemory, cache_turn_on
from dsp.modules.lm import LM


class DSPyLiteLLM(dspy.OpenAI):
    def __init__(self, **kwargs):
        model = kwargs["model"]
        if "azure/" in model:
            kwargs["litellm_params"] = {"api_version": os.environ["AZURE_API_VERSION"]}
        kwargs["drop_params"] = True
        kwargs["model_type"] = "chat"
        self.last_cost = 0
        super().__init__(**kwargs)

    def basic_request(self, prompt: str, **kwargs):
        raw_kwargs = kwargs

        kwargs = {**self.kwargs, **kwargs}
        # caching mechanism requires hashable kwargs
        messages = [{"role": "user", "content": prompt}]
        if self.system_prompt:
            messages.insert(0, {"role": "system", "content": self.system_prompt})
        kwargs["messages"] = messages
        kwargs = {"stringify_request": json.dumps(kwargs)}
        response = chat_request(**kwargs)

        # TODO: is this necessary?
        # history = {
        #     "prompt": prompt,
        #     "response": response,
        #     "kwargs": kwargs,
        #     "raw_kwargs": raw_kwargs,
        # }
        # self.history.append(history)

        self.last_cost = completion_cost(
            completion_response=response,
            # TODO: use https://docs.litellm.ai/docs/completion/token_usage#9-register_model all the way from frontend to litellm params for custom model costs
            # custom_cost_per_token={
            #     "input_cost_per_token": 0.1,
            #     "output_cost_per_token": 0.3,
            # },
        )

        return response


@CacheMemory.cache
def v1_cached_gpt3_turbo_request_v2(**kwargs):
    if "stringify_request" in kwargs:
        kwargs = json.loads(kwargs["stringify_request"])
    return litellm.completion(**kwargs)


@functools.lru_cache(maxsize=None if cache_turn_on else 0)
@NotebookCacheMemory.cache
def v1_cached_gpt3_turbo_request_v2_wrapped(**kwargs):
    return v1_cached_gpt3_turbo_request_v2(**kwargs)


def chat_request(**kwargs):
    return v1_cached_gpt3_turbo_request_v2_wrapped(**kwargs).model_dump()  # type: ignore
