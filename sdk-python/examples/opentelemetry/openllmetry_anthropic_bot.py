# This example uses the OpenTelemetry instrumentation for OpenAI from OpenLLMetry: https://pypi.org/project/opentelemetry-instrumentation-openai/

from dotenv import load_dotenv

import langwatch

load_dotenv()

import chainlit as cl

from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor
import anthropic

client = anthropic.Anthropic()
langwatch.setup(
    instrumentors=[AnthropicInstrumentor()],
)


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    completion = client.messages.create(
        model="claude-3-5-sonnet-20240620",
        max_tokens=1000,
        temperature=0,
        stream=True,
        system="You are a world-class poet. Respond only with short poems.",
        messages=[
            {
                "role": "user",
                "content": [{"type": "text", "text": "Why is the ocean salty?"}],
            }
        ],
    )

    for part in completion:
        if part.type == "content_block_delta":
            await msg.stream_token(part.delta.text or "")

    await msg.update()
