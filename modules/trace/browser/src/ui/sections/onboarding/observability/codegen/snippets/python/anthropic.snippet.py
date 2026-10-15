import langwatch  # +
from anthropic import Anthropic
import os

from openinference.instrumentation.anthropic import AnthropicInstrumentor  # +

langwatch.setup(instrumentors=[AnthropicInstrumentor()])  # +

client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


@langwatch.trace(name="Anthropic Call with Community Instrumentor")
def generate_text_with_community_instrumentor(prompt: str):
    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


if __name__ == "__main__":
    user_query = "Tell me a joke"
    response = generate_text_with_community_instrumentor(user_query)
    print(f"User: {user_query}")
    print(f"AI: {response}")
