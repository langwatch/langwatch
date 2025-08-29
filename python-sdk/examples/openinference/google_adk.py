"""
Google ADK Agent with LangWatch Observability

This example demonstrates how to use Google ADK (Agent Development Kit) with LangWatch
for comprehensive observability, monitoring, and evaluation of your AI agents.

Features demonstrated:
- Automatic tracing of all agent interactions
- Tool usage with weather information
- Custom metadata and context
- Error handling and debugging
- Session management
- Streaming responses

Requirements:
- pip install langwatch google-adk openinference-instrumentation-google-adk
- Set LANGWATCH_API_KEY and GOOGLE_API_KEY environment variables
"""

from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
import langwatch
from openinference.instrumentation.google_adk import GoogleADKInstrumentor
from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.genai import types
import nest_asyncio

nest_asyncio.apply()

# Initialize LangWatch once at module level
langwatch.setup(instrumentors=[GoogleADKInstrumentor()])


def get_weather(city: str):
    """Get weather for a city."""
    weather_data = {
        "new york": "Sunny, 25°C (77°F), Humidity: 65%",
        "london": "Cloudy, 18°C (64°F), Humidity: 80%",
        "tokyo": "Rainy, 22°C (72°F), Humidity: 85%",
    }

    city_lower = city.lower()
    if city_lower in weather_data:
        return {"status": "success", "report": weather_data[city_lower]}
    else:
        return {"status": "error", "message": f"Weather for '{city}' not available."}


def get_stock_price(symbol: str):
    """Get stock price for a symbol."""
    stock_data = {
        "AAPL": {"price": 175.50, "change": 2.30},
        "GOOGL": {"price": 142.80, "change": -1.20},
        "MSFT": {"price": 380.25, "change": 5.75},
    }

    symbol_upper = symbol.upper()
    if symbol_upper in stock_data:
        data = stock_data[symbol_upper]
        return {
            "status": "success",
            "price": f"${data['price']:.2f}",
            "change": f"${data['change']:+.2f}",
        }
    else:
        return {"status": "error", "message": f"Stock '{symbol}' not available."}


@cl.on_chat_start
async def on_chat_start():
    agent = Agent(
        name="multi_tool_agent",
        model="gemini-2.0-flash-exp",
        description="Agent with weather and stock tools.",
        instruction="Use available tools to answer questions.",
        tools=[get_weather, get_stock_price],
    )

    cl.user_session.set("agent", agent)
    cl.user_session.set("runner", InMemoryRunner(agent=agent, app_name="demo"))


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    agent = cl.user_session.get("agent")
    runner = cl.user_session.get("runner")

    msg = cl.Message(content="")

    langwatch.get_current_trace().update(
        metadata={"labels": ["google_adk"], "agent_name": agent.name}
    )

    # Create session for this interaction
    session_service = runner.session_service
    await session_service.create_session(
        app_name="demo", user_id="user", session_id="session"
    )

    async for event in runner.run_async(
        user_id="user",
        session_id="session",
        new_message=types.Content(
            role="user", parts=[types.Part(text=message.content)]
        ),
    ):
        if event.is_final_response():
            response = event.content.parts[0].text.strip()
            await msg.stream_token(response)
            break

    await msg.update()
