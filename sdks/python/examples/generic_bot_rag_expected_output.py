from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch


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

            with rag_span.span(type="llm", input=str(contexts) + " " + message.content) as llm_span:
                generated_message = "Hello there! How can I help?"
                llm_span.update(output=generated_message)

        # Set what is the expected output of the trace, to be used on evaluations like Ragas Correctness
        trace.update(
            expected_output="Hello there! How can I be helpful?"
        )

        public_url = trace.share() # it works even before the trace was fully synced, but users might take a second to see on the UI
        print("See the trace at:", public_url)

    await msg.stream_token(generated_message)
    await msg.update()
