import time
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch


@langwatch.span(type="llm")
def generate(message: str):
    time.sleep(1)  # generating the message...

    raise Exception("This exception will be captured by LangWatch automatically")


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    generated_message = generate(message.content)

    await msg.stream_token(generated_message)
    await msg.update()
