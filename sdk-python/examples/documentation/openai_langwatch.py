import langwatch
from openai import OpenAI

# Ensure LANGWATCH_API_KEY is set in your environment, or set it in `setup`
langwatch.setup()

# Initialize your OpenAI client
client = OpenAI()


@langwatch.trace(name="OpenAI Chat Completion")
async def get_openai_chat_response(user_prompt: str):
    # Get the current trace and enable autotracking for the 'client' instance
    langwatch.get_current_trace().autotrack_openai_calls(client)

    # All calls made with 'client' will now be automatically captured as spans
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": user_prompt}],
    )
    completion = response.choices[0].message.content
    return completion


async def main():
    user_query = "Tell me a joke about Python programming."
    response = await get_openai_chat_response(user_query)
    print(f"User: {user_query}")
    print(f"AI: {response}")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
