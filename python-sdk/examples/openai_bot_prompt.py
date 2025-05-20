from dotenv import load_dotenv
import os

load_dotenv()

from openai import OpenAI

client = OpenAI()

import langwatch.prompts
import asyncio

langwatch.setup(
    api_key=os.getenv("LANGWATCH_API_KEY"),
    endpoint_url=os.getenv("LANGWATCH_ENDPOINT"),
)

@langwatch.trace()
async def main():
    print("Starting main for test")

    langwatch.get_current_trace().autotrack_openai_calls(client)

    ## Gets the prompt and autobuilds it with the provided variables
    ## Returns an object that can be passed into the OpenAI client
    ## directly: 
    # Raw prompt {model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is {user_name} and their email is {user_email}' }]}
    # Autobuilt prompt { model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is John Doe and their email is john.doe@example.com' }]}
    prompt_id = "prompt_sNaxvV8ZrrdjNA_6b1WHw"
    prompt = langwatch.prompts.get_prompt(prompt_id)
    messages = prompt.format_messages(input="I like to eat pizza")

    print(prompt)
    completion = client.chat.completions.create(model=prompt.model, messages=messages)
    print(completion)

if __name__ == "__main__":
    asyncio.run(main())
