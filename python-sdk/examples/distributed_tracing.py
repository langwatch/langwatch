import time
from dotenv import load_dotenv
import httpx
import nanoid
import threading

load_dotenv()

import chainlit as cl
from openai import OpenAI
import langwatch

client = OpenAI()


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().update(
        metadata={"labels": ["distributed_tracing"]},
    )

    msg = cl.Message(
        content="",
    )

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
        stream_options={"include_usage": True},
    )

    full_response = ""
    for part in completion:
        if len(part.choices) == 0:
            continue
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)
            full_response += token

    trace_id = f"trace_{nanoid.generate()}"

    def send_span(index: int):
        with httpx.Client() as httpx_client:
            httpx_client.post(
                f"{langwatch.get_endpoint()}/api/collector",
                json={
                    "trace_id": trace_id,
                    "spans": [
                        {
                            "type": "span",
                            "span_id": f"span_{nanoid.generate()}",
                            "input": {
                                "type": "text",
                                "value": message.content,
                            },
                            "output": {
                                "type": "text",
                                "value": f"{full_response} (span {index})",
                            },
                            "timestamps": {
                                "started_at": int(time.time() * 1000),
                                "finished_at": int(time.time() * 1000),
                            },
                        }
                    ],
                },
                headers={
                    "X-Auth-Token": str(langwatch.get_api_key()),
                    "Content-Type": "application/json",
                },
            )

    threads = []
    for i in range(10):
        thread = threading.Thread(target=send_span, args=(i,))
        threads.append(thread)
        thread.start()

    # Wait for all threads to complete
    for thread in threads:
        thread.join()

    await msg.update()
