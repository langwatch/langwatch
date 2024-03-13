import os
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import AzureOpenAI

import sys

sys.path.append("..")
import langwatch
import langwatch.openai

client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-02-01",
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),  # type: ignore
)
langwatch.api_key = os.getenv("LANGWATCH_API_KEY")


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with langwatch.openai.AzureOpenAITracer(
        client,
        trace_id=message.id,  # optional
        metadata={"user_id": message.author},  # optional
    ):
        completion = client.chat.completions.create(
            model="gpt-35-turbo-0613",
            messages=[
                {
                    "role": "system",
                    "content": "come up with a query for searching the database based on user question, 3 words max",
                },
                {"role": "user", "content": message.content},
            ],
        )

        query = completion.choices[0].message.content

        search_results = [
            {
                "id": "result_1",
                "content": "This is the first result",
            },
            {
                "id": "result_2",
                "content": "This is the second result",
            },
        ]

        with langwatch.capture_rag(
            input=query,
            contexts=[
                {"document_id": docs["id"], "content": docs["content"]}
                for docs in search_results
            ],
        ):
            results = "\n".join(
                [f"{docs['id']}: {docs['content']}" for docs in search_results]
            )
            completion = client.chat.completions.create(
                model="gpt-35-turbo-0613",
                messages=[
                    {
                        "role": "system",
                        "content": f"""
                            You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.

                            We just made a search in the database for {query} and found {len(search_results)} results. Here they are, use that to help answering user:

                            {results}
                        """,
                    },
                    {"role": "user", "content": message.content},
                ],
                stream=True,
            )

    for part in completion:
        if len(part.choices) == 0:
            continue

        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
