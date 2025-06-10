from dotenv import load_dotenv

from langwatch.types import RAGChunk

load_dotenv()

import chainlit as cl
from openai import OpenAI

client = OpenAI()

import langwatch.openai


@langwatch.span(type="rag")
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

    # capture then on the span contexts with RAGChunk before returning
    langwatch.get_current_span().update(
        contexts=[
            RAGChunk(
                document_id=document["id"],
                content=document["content"],
            )
            for document in search_results
        ]
    )

    return search_results


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_openai_calls(client)
    langwatch.get_current_trace().update(
        metadata={"labels": ["openai", "rag"]},
    )

    msg = cl.Message(
        content="",
    )

    contexts = rag_retrieval(message.content)

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
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
