from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI
import langwatch

client = OpenAI()


@cl.on_message
@langwatch.trace(max_string_length=100)  # default is 5000
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_openai_calls(client)

    msg = cl.Message(
        content="",
    )

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
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

    for part in completion:
        if len(part.choices) == 0:
            continue
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
