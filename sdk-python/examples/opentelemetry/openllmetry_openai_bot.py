# This example uses the OpenTelemetry instrumentation for OpenAI from OpenLLMetry: https://pypi.org/project/opentelemetry-instrumentation-openai/

from dotenv import load_dotenv

import langwatch

load_dotenv()

import chainlit as cl

from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from openai import OpenAI


client = OpenAI()

langwatch.setup(
    instrumentors=[OpenAIInstrumentor()],
)


@cl.on_message
async def main(message: cl.Message):
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
    )

    for part in completion:
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
