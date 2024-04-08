import time
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import sys

sys.path.append("..")
import nanoid
import langwatch.tracer


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with langwatch.tracer.BaseContextTracer(trace_id=nanoid.generate(), metadata={}):
        with langwatch.tracer.ContextSpan(
            span_id=nanoid.generate(),
            name=None,
            type="llm",
            input=message.content,
        ) as span:
            time.sleep(1)  # generating the message...
            generated_message = "Hello there! How can I help?"

            span.output = generated_message

        await msg.stream_token(generated_message)

    await msg.update()
