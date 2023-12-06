import chainlit as cl
from openai import OpenAI

client = OpenAI()

import sys

sys.path.append("..")
import langwatch.openai


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with langwatch.openai.OpenAITracer(client):
        completion = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
                },
                {"role": "user", "content": message.content},
            ],
            stream=True,
        )

    for part in completion:
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
