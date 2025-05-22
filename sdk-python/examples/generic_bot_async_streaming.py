import time
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch


@langwatch.span(type="llm")
async def stream_tokens(tokens: list[str]):
    langwatch.get_current_span().update(model="custom_model")
    for token in tokens:
        yield token


@langwatch.trace()
async def generate(message: str):
    time.sleep(0.5)  # generating the message...

    async for token in stream_tokens(["Hello", " there! "]):
        yield token

    time.sleep(0.5)  # generating the message...

    async for token in stream_tokens(["How", " can", " I", " help?"]):
        yield token


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    async for token in generate(message.content):
        await msg.stream_token(token)

    await msg.update()
