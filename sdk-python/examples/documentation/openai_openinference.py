import langwatch
from openai import OpenAI

# Example using OpenInference's OpenAIInstrumentor
from openinference.instrumentation.openai import OpenAIInstrumentor

# Initialize LangWatch with the OpenAIInstrumentor
langwatch.setup(
    instrumentors=[OpenAIInstrumentor()]
)

client = OpenAI()

@langwatch.trace(name="OpenAI Call with Community Instrumentor")
def generate_text_with_community_instrumentor(prompt: str):
    # No need to call autotrack explicitly, the community instrumentor handles OpenAI calls globally.
    response = client.chat.completions.create(
        model="gpt-4.1-nano",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content

if __name__ == "__main__":
    user_query = "Tell me a joke about Python programming."
    response = generate_text_with_community_instrumentor(user_query)
    print(f"User: {user_query}")
    print(f"AI: {response}")
