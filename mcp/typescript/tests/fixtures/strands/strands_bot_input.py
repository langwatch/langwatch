import os
from strands import Agent, tool
from strands.models.litellm import LiteLLMModel

from dotenv import load_dotenv

load_dotenv()

import chainlit.config as cl_config
import chainlit as cl

cl_config.config.project.enable_telemetry = False


@tool
def get_user_location() -> str:
    """Get the user's location."""

    # Implement user location lookup logic here
    return "London, UK"


class KiteAgent:
    def __init__(self):
        self.model = LiteLLMModel(
            client_args={
                "api_key": os.getenv("OPENAI_API_KEY"),
            },
            model_id="openai/gpt-5-mini",
        )
        self.agent = Agent(
            name="kite-agent",
            model=self.model,
            system_prompt="Always use the get_user_location tool before answering any questions.",
            tools=[get_user_location],
        )

    def run(self, prompt: str):
        return self.agent(prompt)


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    agent = KiteAgent()
    response = agent.run(message.content)

    await msg.stream_token(str(response))
    await msg.update()
