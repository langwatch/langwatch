from dotenv import load_dotenv
from fastapi.testclient import TestClient

load_dotenv()

import os
import langwatch
from fastapi import FastAPI
from openai import OpenAI
from pydantic import BaseModel
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

client = OpenAI()


# Set up OpenTelemetry trace provider with LangWatch as the endpoint
tracer_provider = trace_sdk.TracerProvider(
    resource=Resource(attributes={"service.name": "fastapi_sample_endpoint"})
)
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


app = FastAPI()
# Instrument FastAPI with OpenTelemetry
FastAPIInstrumentor.instrument_app(app)
trace.set_tracer_provider(tracer_provider)
tracer = trace.get_tracer(__name__)


class EndpointParams(BaseModel):
    input: str


@app.post("/")
@langwatch.trace(name="fastapi_sample_endpoint")
def fastapi_sample_endpoint(params: EndpointParams):
    langwatch.get_current_trace().autotrack_openai_calls(client)

    completion = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": params.input},
        ],
    )

    return completion.choices[0].message.content


def call_fastapi_sample_endpoint(input: str) -> str:
    test_client = TestClient(app)
    response = test_client.post("/", json={"input": input})

    return response.json()


if __name__ == "__main__":
    import uvicorn
    import os

    # Test one llm call before starting the server
    print(call_fastapi_sample_endpoint("Hello, world!"))

    port = int(os.environ.get("PORT", 9000))
    uvicorn.run(app, host="0.0.0.0", port=port)
