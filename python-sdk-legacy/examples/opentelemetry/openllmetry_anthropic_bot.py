# This example uses the OpenTelemetry instrumentation for OpenAI from OpenLLMetry: https://pypi.org/project/opentelemetry-instrumentation-openai/

from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import os
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor
import anthropic

client = anthropic.Anthropic()


# Set up OpenTelemetry trace provider with LangWatch as the endpoint
tracer_provider = trace_sdk.TracerProvider()
tracer_provider.add_span_processor(
    SimpleSpanProcessor(
        OTLPSpanExporter(
            endpoint=f"{os.environ.get('LANGWATCH_ENDPOINT', 'https://app.langwatch.ai')}/api/otel/v1/traces",
            headers={"Authorization": "Bearer " + os.environ["LANGWATCH_API_KEY"]},
        )
    )
)
# Optionally, you can also print the spans to the console.
tracer_provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))

AnthropicInstrumentor().instrument(tracer_provider=tracer_provider)


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    completion = client.messages.create(
        model="claude-3-5-sonnet-20240620",
        max_tokens=1000,
        temperature=0,
        stream=True,
        system="You are a world-class poet. Respond only with short poems.",
        messages=[
            {
                "role": "user",
                "content": [{"type": "text", "text": "Why is the ocean salty?"}],
            }
        ],
    )

    for part in completion:
        if part.type == "content_block_delta":
            await msg.stream_token(part.delta.text or "")

    await msg.update()
