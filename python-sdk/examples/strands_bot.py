from strands import Agent, tool
from strands.models.litellm import LiteLLMModel
import os
import langwatch

from openinference.instrumentation.litellm import LiteLLMInstrumentor

from dotenv import load_dotenv

from langwatch.telemetry.context import _is_on_child_thread

load_dotenv()

import chainlit as cl
from strands.telemetry import StrandsTelemetry
from strands_tools import calculator, file_read, shell

strands_telemetry = StrandsTelemetry().setup_otlp_exporter(
    endpoint="https://app.langwatch.ai/api/otel/v1/traces",
    headers={"Authorization": f"Bearer {os.environ['LANGWATCH_API_KEY']}"},
)

@tool
@langwatch.span(type="tool")
def get_user_location() -> str:
    """Get the user's location."""

    # Implement user location lookup logic here
    return "Seattle, USA"


class KiteAgent:
    def __init__(self):
        langwatch.setup(instrumentors=[LiteLLMInstrumentor()])

        self.model = LiteLLMModel(
            client_args={
                "api_key": os.getenv("OPENAI_API_KEY"),
            },
            model_id="openai/gpt-4.1-nano",
        )
        self.agent = Agent(
            model=self.model,
            tools=[get_user_location]
        )

    def run(self, prompt: str):
        return self.agent(prompt)


@cl.on_message
# @langwatch.trace()
async def main(message: cl.Message):
    # langwatch.get_current_trace().autotrack_litellm_calls(litellm)

    msg = cl.Message(
        content="",
    )

    agent = KiteAgent()
    response = agent.run(message.content)

    await msg.stream_token(str(response))

    await msg.update()
