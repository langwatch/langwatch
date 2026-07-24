import time
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch


@langwatch.span(type="llm")
def generate(contexts: list[str], message: str):
    time.sleep(1)  # generating the message...

    generated_message = "Hello there! How can I help?"

    langwatch.get_current_span().update(model="custom_model")

    return generated_message


@langwatch.span(type="rag")
def retrieve(message: str):
    time.sleep(0.5)
    contexts = ["context1", "context2"]

    langwatch.get_current_span().update(contexts=contexts)

    return contexts


@langwatch.span()
def rag(message: str):
    contexts = retrieve(message)
    return generate(contexts, message)


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    generated_message = rag(message.content)

    await msg.stream_token(generated_message)
    await msg.update()
