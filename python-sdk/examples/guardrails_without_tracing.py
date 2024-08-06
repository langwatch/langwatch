from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI

client = OpenAI()

import langwatch.guardrails


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    jailbreak_guardrail = langwatch.guardrails.evaluate(
        "jailbreak-detection", input=message.content
    )
    if not jailbreak_guardrail.passed:
        await msg.stream_token(f"I'm sorry, I can't help you with that.")
        await msg.update()
        return

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

    for part in completion:
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
