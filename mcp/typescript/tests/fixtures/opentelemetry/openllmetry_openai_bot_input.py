# This example uses the OpenTelemetry instrumentation for OpenAI from OpenLLMetry

from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI

# Manual instrumentation setup would go here
from openllmetry.instrumentation.openai import OpenAIInstrumentor

OpenAIInstrumentor().instrument()

client = OpenAI()


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    completion = client.chat.completions.create(
        model="gpt-5",
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
