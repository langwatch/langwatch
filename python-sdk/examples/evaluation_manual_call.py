from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI

client = OpenAI()

import langwatch


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_openai_calls(client)

    msg = cl.Message(
        content="",
    )

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": message.content},
        ],
        stream=True,
    )

    full_response = ""
    for part in completion:
        if token := part.choices[0].delta.content or "":
            full_response += token
            await msg.stream_token(token)

    answer_relevancy = langwatch.get_current_span().evaluate(
        "ragas/answer_relevancy",
        name="Manually Called Answer Relevancy",
        input=message.content,
        output=full_response,
        settings={
            "max_tokens": 512,
        },
    )

    langwatch.get_current_span().add_evaluation(
        name="Useful Message Evaluation",
        passed=True,
        score=99,
        details="This is a custom manual evaluation",
    )

    await msg.stream_token(
        f"Answer Relevancy: {answer_relevancy.score} {answer_relevancy.details if answer_relevancy.details else ''}"
    )

    await msg.update()
