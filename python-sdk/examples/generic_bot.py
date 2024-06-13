import time
from dotenv import load_dotenv

from langwatch.types import LLMSpan

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

    with langwatch.tracer.BaseContextTracer(
        trace_id=nanoid.generate(), metadata={}
    ) as tracer:
        started_at_ts = int(time.time() * 1000)  # time must be in milliseconds

        time.sleep(1)  # generating the message...

        generated_message = "Hello there! How can I help?"

        tracer.append_span(
            LLMSpan(
                type="llm",
                span_id=nanoid.generate(),
                model="llama2",
                input={
                    "type": "chat_messages",
                    "value": [
                        {"role": "user", "content": message.content},
                    ],
                },
                output={
                    "type": "chat_messages",
                    "value": [
                        {
                            "role": "assistant",
                            "content": generated_message,
                        }
                    ],
                },
                timestamps={
                    "started_at": started_at_ts,
                    "finished_at": int(time.time() * 1000),
                },
            )
        )

        await msg.stream_token(generated_message)

    await msg.update()
