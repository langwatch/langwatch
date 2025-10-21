import langwatch  # +
import os

from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.yfinance import YFinanceTools
from openinference.instrumentation.agno import AgnoInstrumentor

langwatch.setup(instrumentors=[AgnoInstrumentor()])  # +

# Create and configure your Agno agent
agent = Agent(
    name="Stock Price Agent",
    model=OpenAIChat(id="gpt-5"),
    tools=[YFinanceTools()],
    instructions="You are a stock price agent. Answer questions in the style of a stock analyst.",
    debug_mode=True,
)

agent.print_response("What is the current price of Nvidia?")
