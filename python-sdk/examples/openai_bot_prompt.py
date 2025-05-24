import os

from dotenv import load_dotenv

load_dotenv()

from openai import OpenAI

client = OpenAI()

import langwatch.prompt

import chainlit as cl

langwatch.setup()


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_openai_calls(client)
    langwatch.get_current_trace().update(
        metadata={"labels": ["openai", "prompt-versioning"]},
    )

    msg = cl.Message(
        content="",
    )

    ## Gets the prompt and autobuilds it with the provided variables
    ## Returns an object that can be passed into the OpenAI client
    ## directly:
    # Raw prompt {model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is {{user_name}} and their email is {{user_email}}' }, { role: 'user', content: '{{input}}' }]}
    # Autobuilt prompt { model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is John Doe and their email is john.doe@example.com' }, { role: 'user', content: 'I like to eat pizza' }]}
    # Public documentation example prompt
    prompt_id = os.getenv("LANGWATCH_PROMPT_ID", "prompt_TrYXZLsiTJkn9N6PiZiae")
    prompt = langwatch.prompt.get_prompt(prompt_id)
    print(prompt.raw_config())
    messages = prompt.format_messages(
        user_name="John Doe",
        user_email="john.doe@example.com",
        input="I like to eat pizza",
    )

    completion = client.chat.completions.create(
        model=prompt.model.split("openai/")[1],
        messages=messages,
        stream=True,
    )

    for part in completion:
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
