import langwatch  # +
import os

from agno.agent import Agent
from agno.models.openai import OpenAIChat
from openinference.instrumentation.agno import AgnoInstrumentor  # +

langwatch.setup(instrumentors=[AgnoInstrumentor()])  # +

# Create and configure your Agno agent
agent = Agent(
    name="A helpful AI Assistant",
    model=OpenAIChat(id="gpt-5"),
    tools=[],
    instructions="You are a helpful AI Assistant.",
    debug_mode=True,
)

agent.print_response("Tell me a joke.")
