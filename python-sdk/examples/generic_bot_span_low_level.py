import time
import uuid
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with langwatch.trace(
        trace_id=uuid.uuid4(),
    ) as trace:
        with trace.span(
            type="span",
            input=message.content,
        ) as span:
            with span.span(
                type="llm", input=message.content, model="openai/gpt-4o-mini"
            ) as nested_span:
                time.sleep(1)  # generating the message...
                generated_message = "Hello there! How can I help from low level?"
                nested_span.update(output=generated_message)

    await msg.stream_token(generated_message)
    await msg.update()
