from dotenv import load_dotenv
import os

load_dotenv()

import chainlit as cl
from openai import OpenAI
import langwatch

from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

import time

client = OpenAI()

exporter = OTLPMetricExporter(
    endpoint=f"{os.environ.get('LANGWATCH_ENDPOINT', 'https://app.langwatch.ai')}/api/otel/v1/metrics",
    headers={"Authorization": "Bearer " + os.environ["LANGWATCH_API_KEY"]},
)


reader = PeriodicExportingMetricReader(exporter)
provider = MeterProvider(
    resource=Resource.create({"service.name": "my-agent"}), metric_readers=[reader]
)
metrics.set_meter_provider(provider)
meter = metrics.get_meter("gen_ai.server")

# Create the histogram
time_to_first_token_hist = meter.create_histogram(
    name="gen_ai.server.time_to_first_token",
    unit="s",
    description="Time to generate first token for successful responses",
)


@langwatch.trace(type="llm")
async def do_call_llm(content: str, msg):
    start_time = time.time()
    completion = client.chat.completions.create(
        model="gpt-5",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": content},
        ],
        stream=True,
        stream_options={"include_usage": True},
    )

    first_token_time = None
    full_response = ""
    for part in completion:
        if len(part.choices) == 0:
            continue
        if token := part.choices[0].delta.content or "":
            if first_token_time is None:
                first_token_time = time.time()
                record_first_token_latency((time.time() - start_time) * 1000)
            await msg.stream_token(token)
            full_response += token

    langwatch.get_current_trace().update(output=full_response)


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    await do_call_llm(message.content, msg)

    await msg.update()


def record_first_token_latency(milliseconds: float):
    seconds = milliseconds / 1000.0
    print(f"Record first token latency: {seconds} seconds")
    time_to_first_token_hist.record(
        seconds, attributes={"model": "gpt-5", "request.status": "success"}
    )
