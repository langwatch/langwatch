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
    try:
        langwatch.get_current_trace().autotrack_openai_calls(client)
        langwatch.get_current_trace().update(
            metadata={"labels": ["openai", "prompt-versioning"]},
        )
        # Print the current tracing span for debugging/inspection purposes.
        # This helps developers understand the current tracing context.
        trace = langwatch.get_current_trace()
        print(f"Current trace id: {trace.trace_id}")

        msg = cl.Message(
            content="",
        )

        ## Gets the prompt and autobuilds it with the provided variables
        ## Returns an object that can be passed into the OpenAI client
        ## directly:
        # Raw prompt {model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is {{user_name}} and their email is {{user_email}}' }, { role: 'user', content: '{{input}}' }]}
        # Autobuilt prompt { model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is John Doe and their email is john.doe@example.com' }, { role: 'user', content: 'I like to eat pizza' }]}
        # Public documentation example prompt
        prompt_id = os.getenv("LANGWATCH_PROMPT_ID", "prompt_s5ov0JcFRiGo0Lzq5IcVH")
        prompt = langwatch.prompt.get_prompt(prompt_id)
        print(prompt.raw_config())
        messages = prompt.format_messages(
            user_name="John Doe",
            user_email="john.doe@example.com",
            input=message.content,
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
    except Exception as ex:
        print(f"Error: {ex}")
        raise
