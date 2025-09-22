import os
from strands import Agent, tool
from strands.models.litellm import LiteLLMModel
import langwatch

from dotenv import load_dotenv

load_dotenv()

import chainlit.config as cl_config
import chainlit as cl

cl_config.config.project.enable_telemetry = False

# OpenTelemetry Setup Options:


# Option 1: Use only the LangWatch SDK. This is the simplest option.
langwatch.setup()  # The api key is set from the environment variable automatically


# Option 2: Use StrandsTelemetry to handle complete OpenTelemetry setup
# (Creates new tracer provider and sets it as global)
# from strands.telemetry import StrandsTelemetry
# strands_telemetry = StrandsTelemetry()
# strands_telemetry.setup_otlp_exporter(
#     endpoint=f"{os.environ.get('LANGWATCH_ENDPOINT', 'https://app.langwatch.ai')}/api/otel/v1/traces",
#     headers={"Authorization": "Bearer " + os.environ["LANGWATCH_API_KEY"]},
# )
# As OTel is managed by StrandsTelemetry, we must skip setting it up in LangWatch
# langwatch.setup(skip_open_telemetry_setup=True)


@tool
@langwatch.span(type="tool")
def get_user_location() -> str:
    """Get the user's location."""

    # Implement user location lookup logic here
    return "London, UK"


model_id = "openai/gpt-5-mini"


class KiteAgent:
    def __init__(self):
        self.model = LiteLLMModel(
            client_args={
                "api_key": os.getenv("OPENAI_API_KEY"),
            },
            model_id=model_id,
        )
        self.agent = Agent(
            # name="kite-agent", // Name parameter is not supported
            model=self.model,
            system_prompt="Always use the get_user_location tool before answering any questions.",
            tools=[get_user_location],
            trace_attributes={
                "custom.model_id": model_id,
                "custom.example.attribute": "swift",
            },
        )

    def run(self, prompt: str):
        return self.agent(prompt)


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    langwatch.get_current_trace().update(
        metadata={
            "custom.example.attribute2": "langwatch",
        }
    )

    agent = KiteAgent()
    response = agent.run(message.content)

    await msg.stream_token(str(response))
    await msg.update()
