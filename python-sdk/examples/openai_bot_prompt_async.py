from dotenv import load_dotenv

load_dotenv()

from openai import AsyncOpenAI

client = AsyncOpenAI()

import langwatch.prompt
import asyncio

langwatch.setup()

@langwatch.trace()
async def main():
    print("Starting main for test")

    langwatch.get_current_trace().autotrack_openai_calls(client)

    ## Gets the prompt and autobuilds it with the provided variables
    ## Returns an object that can be passed into the OpenAI client
    ## directly:
    # Raw prompt {model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is {user_name} and their email is {user_email}' }]}
    # Autobuilt prompt { model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is John Doe and their email is john.doe@example.com' }]}
    prompt_id = "prompt_jTJP5ob_8zlTp7Jw0kNac"
    prompt = await langwatch.prompt.async_get_prompt(prompt_id)
    print(prompt.raw_config())
    messages = prompt.format_messages(input="I like to eat pizza")
    completion = await client.chat.completions.create(model=prompt.model, messages=messages)
    print(completion)

if __name__ == "__main__":
    asyncio.run(main())
