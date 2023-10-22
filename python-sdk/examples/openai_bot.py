import chainlit as cl
import openai

import sys

sys.path.append("..")
import langwatch.openai


@cl.on_message
async def main(message: str):
    msg = cl.Message(
        content="",
    )

    with langwatch.openai.OpenAITracer():
        completion = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
                },
                {"role": "user", "content": message},
            ],
            stream=True,
        )

    for delta in completion:
        await msg.stream_token(delta.get("choices")[0].get("delta").get("content", ""))  # type: ignore
    await msg.send()
