import langwatch  # +
from openai import OpenAI

langwatch.setup()  # +
client = OpenAI()


@langwatch.trace(name="OpenAI Chat Completion")
def get_openai_chat_response(user_prompt: str):
    langwatch.get_current_trace().autotrack_openai_calls(client)  # +

    response = client.chat.completions.create(
        model="gpt-5",
        messages=[{"role": "user", "content": user_prompt}],
    )
    completion = response.choices[0].message.content
    return completion


if __name__ == "__main__":
    user_query = "Tell me a joke"
    response = get_openai_chat_response(user_query)

    print(f"User: {user_query}")
    print(f"AI: {response}")
