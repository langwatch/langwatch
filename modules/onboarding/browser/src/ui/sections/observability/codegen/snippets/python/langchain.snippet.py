import langwatch
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langchain_core.runnables import RunnableConfig
import os
import asyncio


langwatch.setup()  # +


def get_weather(city: str) -> str:
    """Get weather for a given city."""
    return f"It's always sunny in {city}!"


agent = create_agent(
    model="openai:gpt-5",
    tools=[get_weather],
    system_prompt="You are a helpful assistant, that can get the weather.",
)


@langwatch.trace(name="Langchain - Weather Agent")  # +
def main(user_question: str):
    result = agent.invoke(
        {"messages": [{"role": "user", "content": user_question}]},
        config=RunnableConfig(
            callbacks=[langwatch.get_current_trace().get_langchain_callback()]  # +
        ),
    )

    return result["messages"][-1].content


if __name__ == "__main__":
    result = main("What is the weather in Philadelphia?")
    print(result)
