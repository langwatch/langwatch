import time
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with langwatch.trace() as trace:
        with trace.span(
            type="llm",
            input=message.content,
        ) as span:
            time.sleep(1)  # generating the message...
            generated_message = "Hello there! How can I help from context manager?"

            span.update(output=generated_message)

        await msg.stream_token(generated_message)

    await msg.update()
