from dotenv import load_dotenv

load_dotenv()

from openai import OpenAI

client = OpenAI()

import langwatch.prompts
import asyncio

@langwatch.trace()
async def main():
    print("Starting main for test")

    langwatch.get_current_trace().autotrack_openai_calls(client)

    ## Gets the prompt and autobuilds it with the provided variables
    ## Returns an object that can be passed into the OpenAI client
    ## directly: 
    # Raw prompt {model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is {user_name} and their email is {user_email}' }]}
    # Autobuilt prompt { model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'The user is John Doe and their email is john.doe@example.com' }]}
    prompt = langwatch.prompts.get_prompt('prompt_GjrWUJ7TIpJ71QGXd-B5M', input="I like to eat pizza")

    print(prompt)

    model = prompt["model"].split("openai/")[1]
    completion = client.chat.completions.create(model=model, messages=prompt["messages"])
    print(completion)

if __name__ == "__main__":
    asyncio.run(main())
