from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI

client = OpenAI()

import sys

sys.path.append("..")
import langwatch.openai


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with langwatch.openai.OpenAITracer(client):
        with langwatch.capture_rag(
            input="What is the capital of France?",
            contexts=[
                {
                    "document_id": "doc-1",
                    "chunk_id": "0",
                    "content": "France is a country in Europe.",
                },
                {
                    "document_id": "doc-2",
                    "chunk_id": "0",
                    "content": "Paris is the capital of France.",
                },
            ],
        ):
            completion = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
                    },
                    {"role": "user", "content": message.content},
                ],
                stream=True,
            )

    for part in completion:
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
