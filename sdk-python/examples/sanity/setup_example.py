import os
import langwatch
import nanoid

from openai import OpenAI
from dotenv import load_dotenv
from langwatch.observability.span import SpanType
from langwatch.attributes import AttributeKey, MetadataName
from opentelemetry.trace import get_current_span
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from openinference.instrumentation.openai import OpenAIInstrumentor
from opentelemetry.trace import SpanKind
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel


load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
app = FastAPI()
tracer = langwatch.new_tracer()

langwatch.setup(
    api_key=os.getenv("LANGWATCH_API_KEY"),
    endpoint_url=os.getenv("LANGWATCH_ENDPOINT_URL"),
    base_attributes={
        AttributeKey.ServiceName: "langwatch-examples-sanity-setup-example",
        AttributeKey.ServiceVersion: "1.0.0",
    },
    instrumentors=[
        OpenAIInstrumentor(),
    ],
)
FastAPIInstrumentor.instrument_app(app)

class Question(BaseModel):
    question: str
    user_id: str

def stream_openai_response(question: str):
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": question}],
        stream=True,
        stream_options={"include_usage": True},
    )
    for chunk in response:
        if "choices" in chunk and len(chunk.choices) > 0:
            delta = chunk.choices[0].get("delta", {})
            content = delta.get("content", "")
            if content:
                yield content

@langwatch.trace(instrumenting_module_name="langwatch.examples.sanity.setup_example", attributes={"trace_attr": "test"})
@app.post("/ask")
async def ask(question: Question):
    return handle_ask(question.question, question.user_id)

@langwatch.span(name="handle_ask", kind=SpanKind.SERVER, type=SpanType.LLM, attributes={"span_attr": "test", MetadataName.ThreadId: nanoid.generate() })
def handle_ask(question: str, user_id: str):
    get_current_span().set_attributes({
        MetadataName.UserId: user_id,
        "question": question,
    })

    return StreamingResponse(stream_openai_response(question), media_type="text/plain")

def main():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

if __name__ == "__main__":
    main()
