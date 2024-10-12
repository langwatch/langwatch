from typing import cast
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
import litellm
from litellm import CustomStreamWrapper
from litellm.types.utils import StreamingChoices

import langwatch


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_litellm_calls(litellm)

    msg = cl.Message(
        content="",
    )

    response = litellm.completion(
        model="groq/llama3-70b-8192",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": message.content},
        ],
        stream=True,
        stream_options={"include_usage": True},
    )

    for part in cast(CustomStreamWrapper, response):
        if token := cast(StreamingChoices, part.choices[0]).delta.content or "":
            await msg.stream_token(token)

    await msg.update()
