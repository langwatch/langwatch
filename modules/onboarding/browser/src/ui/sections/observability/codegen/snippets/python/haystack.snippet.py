import os
import langwatch  # +

from haystack.components.agents import Agent
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.dataclasses import ChatMessage
from openinference.instrumentation.haystack import HaystackInstrumentor  # +

langwatch.setup(instrumentors=[HaystackInstrumentor()])  # +

basic_agent = Agent(
    chat_generator=OpenAIChatGenerator(model="gpt-4o-mini"),
    system_prompt="You are a helpful web agent.",
    tools=[],
)

result = basic_agent.run(messages=[ChatMessage.from_user("Tell me a joke")])

print(result["last_message"].text)
