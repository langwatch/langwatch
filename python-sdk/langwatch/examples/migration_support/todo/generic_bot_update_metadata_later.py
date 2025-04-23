import time
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    trace = langwatch.trace()

    # Create two spans, one for the RAG, and one for the "LLM call" inside it
    rag_span = trace.span(type="rag", input=message.content)
    contexts = ["context1", "context2"]
    rag_span.update(contexts=contexts)

    llm_span = rag_span.span(type="llm", input=str(contexts) + " " + message.content)
    generated_message = "Hello there! How can I help?"
    llm_span.end(output=generated_message)
    rag_span.end(output=generated_message)

    trace.send_spans()

    # At a later point, update the trace with expected_output
    time.sleep(3)
    id = trace.trace_id

    trace = langwatch.trace(trace_id=id)

    trace.update(
        expected_output="Hello there! How can I be helpful?",
        metadata={"labels": ["test"]},
    )
    trace.send_spans()
    public_url = (
        trace.share()
    )  # it works even before the trace was fully synced, but users might take a second to see on the UI
    print("See the trace at:", public_url)

    await msg.stream_token(generated_message)
    await msg.update()
