import os
from dotenv import load_dotenv
load_dotenv()

import langwatch
import chainlit as cl
from openai import OpenAI
from openinference.instrumentation.openai import OpenAIInstrumentor

client = OpenAI()
langwatch.setup(
    instrumentors=[OpenAIInstrumentor()],
)


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    msg = cl.Message(content="")

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only replies in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": message.content},
        ],
        stream=True,
        stream_options={"include_usage": True},
    )

    for part in completion:
        if len(part.choices) == 0:
            continue
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
