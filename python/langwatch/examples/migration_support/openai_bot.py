from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI
import langwatch
from langwatch.observability.span import LangWatchSpan

client = OpenAI()

@cl.on_message
@langwatch.trace(metadata={"modelz": "gpt-4o-mini"})
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_openai_calls(client)

    msg = cl.Message(
        content="",
    )

    # Create an explicit span for the completion
    with LangWatchSpan(
        name="openai_completion",
        type="llm",
        trace=langwatch.get_current_trace(),
        model="gpt-4o-mini",
        input={"messages": [
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": message.content},
        ]},
    ) as span:
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
            stream_options={"include_usage": True},
        )

        response_text = ""
        for part in completion:
            if len(part.choices) == 0:
                continue
            if token := part.choices[0].delta.content or "":
                response_text += token
                await msg.stream_token(token)
        
        # Record the complete response
        span.update_attributes({"output": response_text})

    await msg.update()
