from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI

client = OpenAI()


def rag_retrieval(query: str):
    # the documents you retrieved from your vector database
    search_results = [
        {
            "id": "doc-1",
            "content": "France is a country in Europe.",
        },
        {
            "id": "doc-2",
            "content": "Paris is the capital of France.",
        },
    ]

    return search_results


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    contexts = rag_retrieval(message.content)

    completion = client.chat.completions.create(
        model="gpt-5",
        messages=[
            {
                "role": "system",
                "content": f"You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis. {contexts}",
            },
            {"role": "user", "content": message.content},
        ],
        stream=True,
    )

    for part in completion:
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
