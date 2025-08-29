from strands import Agent
from strands.models.litellm import LiteLLMModel
import os
import langwatch

from openinference.instrumentation.litellm import LiteLLMInstrumentor

from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from strands.telemetry import StrandsTelemetry

strands_telemetry = StrandsTelemetry().setup_otlp_exporter(
    endpoint="https://app.langwatch.ai/api/otel/v1/traces",
    headers={"Authorization": f"Bearer {os.environ['LANGWATCH_API_KEY']}"},
)


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
            tools=[],
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
