import langwatch  # +
import litellm
import os
import asyncio
from typing import cast
from litellm import CustomStreamWrapper
from litellm.types.utils import StreamingChoices

langwatch.setup()  # +


@langwatch.trace(name="LiteLLM Autotrack Example")
def get_litellm_response_autotrack(user_message: str):
    langwatch.get_current_trace().autotrack_litellm_calls(litellm)  # +

    response = litellm.completion(
        model="groq/llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": user_message},
        ],
    )

    return response.choices[0].message.content


if __name__ == "__main__":
    reply = get_litellm_response_autotrack("Tell me a joke")
    print("AI Response:", reply)
