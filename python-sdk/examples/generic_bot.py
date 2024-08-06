import time
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch


@langwatch.span(type="llm")
def generate(message: str):
    time.sleep(1)  # generating the message...

    generated_message = "Hello there! How can I help?"

    langwatch.get_current_span().update(model="custom_model")

    return generated_message


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    langwatch.get_current_trace().update(
        metadata={"user_id": "123", "question_id": "456", "labels": ["some-label"]}
    )

    generated_message = generate(message.content)

    await msg.stream_token(generated_message)
    await msg.update()
