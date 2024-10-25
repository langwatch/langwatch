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

    trace = langwatch.trace(
        trace_id=uuid.uuid4(),
    )
    span = trace.span(
        type="span",
        input=message.content,
    )
    nested_span = span.span(
        type="llm", input=message.content, model="openai/gpt-4o-mini"
    )

    time.sleep(1)  # generating the message...
    generated_message = "Hello there! How can I help from low level?"

    nested_span.end(output=generated_message)
    span.end()

    trace.deferred_send_spans()

    await msg.stream_token(generated_message)
    await msg.update()
