import langwatch  # +
from agents import Agent, Runner
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor  # +
import os
import asyncio

langwatch.setup(instrumentors=[OpenAIAgentsInstrumentor()])  # +

agent = Agent(name="ExampleAgent", instructions="You are a helpful assistant.")


@langwatch.trace(name="OpenAI Agent Run with OpenInference")
async def run_agent_with_openinference(prompt: str):
    result = await Runner.run(agent, prompt)
    return result.final_output


async def main():
    user_query = "Tell me a joke"
    response = await run_agent_with_openinference(user_query)
    print(f"User: {user_query}")
    print(f"AI: {response}")


if __name__ == "__main__":
    asyncio.run(main())
