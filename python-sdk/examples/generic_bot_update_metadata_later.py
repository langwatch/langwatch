import time
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch


# Deprecated, this won't be possible anymore in the future
# Instead, you should use the trace as a context manager
# TODO: update the examples to reflect this

@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with langwatch.trace() as trace:
        # Create two spans, one for the RAG, and one for the "LLM call" inside it
        with trace.span(type="rag", input=message.content) as rag_span:
            contexts = ["context1", "context2"]
            rag_span.update(contexts=contexts)

            with rag_span.span(
                type="llm", input=str(contexts) + " " + message.content
            ) as llm_span:
                generated_message = "Hello there! How can I help?"
                llm_span.update(output=generated_message)

    trace.send_spans()

    # At a later point, update the trace with expected_output
    time.sleep(3)
    id = trace.trace_id

    with langwatch.trace(trace_id=id) as trace:
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
