# This example uses the OpenTelemetry instrumentation for OpenAI from OpenInference: https://pypi.org/project/openinference-instrumentation-openai/

from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import os
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

from openinference.instrumentation.openai import OpenAIInstrumentor
from openinference.instrumentation import using_attributes
from openai import OpenAI

client = OpenAI()


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

OpenAIInstrumentor().instrument(tracer_provider=tracer_provider)


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with using_attributes(
        session_id="my-test-session",
        user_id="my-test-user",
        tags=["tag-1", "tag-2"],
        metadata={"foo": "bar"},
    ):
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
                },
                {"role": "user", "content": message.content},
            ],
            stream=True,
        )

    for part in completion:
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
