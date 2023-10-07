import chainlit as cl
import openai

import sys

sys.path.append("..")
import langwatch


@cl.on_message
async def main(message: str):
    msg = cl.Message(
        content="",
    )

    with langwatch.OpenAITracer():
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
