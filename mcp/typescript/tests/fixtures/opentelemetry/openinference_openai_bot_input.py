# This example uses the OpenTelemetry instrumentation for OpenAI from OpenInference: https://pypi.org/project/openinference-instrumentation-openai/

from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

from openinference.instrumentation.openai import OpenAIInstrumentor
from openinference.instrumentation import using_attributes
from openai import OpenAI

client = OpenAI()

# Manual instrumentation setup would go here
OpenAIInstrumentor().instrument()


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
