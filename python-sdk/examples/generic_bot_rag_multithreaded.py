import time
import uuid
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor
import chainlit as cl
import langwatch

load_dotenv()


@langwatch.span(type="llm")
def generate(question_id: str, contexts: list[str], message: str):
    time.sleep(1)  # generating the message...
    generated_message = "Hello there! How can I help?"
    langwatch.get_current_span().update(model="custom_model")
    return generated_message


@langwatch.span(name="retrieve", type="rag")
def retrieve(question_id: str, message: str):
    time.sleep(0.5)
    contexts = ["context1", "context2"]
    langwatch.get_current_span().update(contexts=contexts)
    return contexts


@langwatch.span(name="parallel_rag")
def parallel_rag(question_id: str, message: str):
    langwatch.get_current_trace().update(trace_id=question_id)

    # Create a ThreadPoolExecutor to run tasks in parallel
    with ThreadPoolExecutor(max_workers=2) as executor:
        # Submit retrieve task
        retrieve_future = executor.submit(retrieve, question_id, message)

        # Wait for retrieve to complete and then submit generate
        contexts = retrieve_future.result() or []
        generate_future = executor.submit(
            generate,
            question_id,
            contexts,
            message,
        )

        # Get the final result
        return generate_future.result()


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    msg = cl.Message(content="")

    question_id = str(uuid.uuid4())
    # Since this is already in an async context, we can run the synchronous
    # parallel_rag in a thread pool to not block
    generated_message = await cl.make_async(parallel_rag)(question_id, message.content)

    await msg.stream_token(generated_message or "")
    await msg.update()
