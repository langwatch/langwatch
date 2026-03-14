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
        model="gpt-5",
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

    pii_detection = langwatch.get_current_span().evaluate(
        "presidio/pii_detection",
        name="Manually Called PII Detection",
        input=message.content,
        output=full_response,
    )

    langwatch.get_current_span().add_evaluation(
        name="Useful Message Evaluation",
        passed=True,
        score=99,
        details="This is a custom manual evaluation",
    )

    await msg.stream_token(
        f"\n\nPII Detection: passed={pii_detection.passed} {pii_detection.details if pii_detection.details else ''}"
    )

    await msg.update()
