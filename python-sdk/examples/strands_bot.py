from strands import Agent
from strands.models.litellm import LiteLLMModel
import os
import langwatch

from openinference.instrumentation.litellm import LiteLLMInstrumentor

from typing import cast
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
import litellm
from litellm import CustomStreamWrapper
from litellm.types.utils import StreamingChoices
from strands.telemetry.tracer import get_tracer

tracer = get_tracer(
    service_name="strands-bot",
    otlp_endpoint=f"{os.environ.get('LANGWATCH_ENDPOINT', 'https://app.langwatch.ai')}/api/otel/v1/traces",
    otlp_headers={"Authorization": "Bearer " + os.environ["LANGWATCH_API_KEY"]},
    enable_console_export=True,  # Helpful for development
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
