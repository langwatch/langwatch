import asyncio
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import AsyncOpenAI

client = AsyncOpenAI()

import langwatch.openai
import langwatch.guardrails


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_openai_calls(client)
    langwatch.get_current_trace().update(
        metadata={"label": "guardrails"},
    )

    msg = cl.Message(
        content="",
    )

    jailbreak_guardrail = asyncio.create_task(
        langwatch.get_current_span().async_evaluate(
            "jailbreak-detection", as_guardrail=True, input=message.content
        )
    )
    off_topic_guardrail = asyncio.create_task(
        langwatch.get_current_span().async_evaluate(
            "off-topic-evaluator", as_guardrail=True, input=message.content
        )
    )

    async def has_guardrails_failed():
        if jailbreak_guardrail.done():
            result = await jailbreak_guardrail
            if not result.passed:
                await msg.stream_token(f"I'm sorry, I can't help you with that.")
                await msg.update()
                return True

        if off_topic_guardrail.done():
            result = await off_topic_guardrail
            if not result.passed:
                await msg.stream_token(f"I'm sorry, I can't help you with that.")
                await msg.update()
                return True

        return False

    completion = await client.chat.completions.create(
        model="gpt-4",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant",  # that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": message.content},
        ],
        stream=True,
    )

    accumulated = []
    async for part in completion:
        if await has_guardrails_failed():
            return

        if token := part.choices[0].delta.content or "":
            accumulated.append(token)

        if off_topic_guardrail.done() and jailbreak_guardrail.done():
            for token in accumulated:
                await msg.stream_token(token)
            accumulated = []

    await asyncio.gather(jailbreak_guardrail, off_topic_guardrail)
    if await has_guardrails_failed():
        return
    for token in accumulated:
        await msg.stream_token(token)

    await msg.update()
