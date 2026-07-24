"""
Metadata and Labels — REST API Example (No SDK)

Demonstrates sending metadata directly via the LangWatch REST API
without using the LangWatch Python SDK.

This is useful when:
- You're using a language/framework without an SDK
- You want full control over trace construction
- You're integrating from a non-Python service that calls Python

Run: python metadata_rest_api_example.py
"""

import json
import os
import time
import uuid

import requests
from dotenv import load_dotenv

load_dotenv()

LANGWATCH_API_KEY = os.environ["LANGWATCH_API_KEY"]
LANGWATCH_ENDPOINT = os.environ.get(
    "LANGWATCH_ENDPOINT", "https://app.langwatch.ai"
)


def send_trace_with_metadata(
    user_message: str,
    assistant_response: str,
    *,
    user_id: str,
    customer_id: str,
    thread_id: str,
    labels: list[str] | None = None,
    custom_metadata: dict | None = None,
) -> requests.Response:
    """
    Send a trace to LangWatch via the REST API with full metadata.
    """
    now_ms = int(time.time() * 1000)

    trace_id = f"trace-{uuid.uuid4().hex[:12]}"
    span_id = f"span-{uuid.uuid4().hex[:12]}"

    payload = {
        "trace_id": trace_id,
        "spans": [
            {
                "type": "llm",
                "span_id": span_id,
                "name": "chat-completion",
                "model": "gpt-4o-mini",
                "input": {
                    "type": "chat_messages",
                    "value": [
                        {
                            "role": "system",
                            "content": "You are a helpful assistant.",
                        },
                        {"role": "user", "content": user_message},
                    ],
                },
                "output": {
                    "type": "chat_messages",
                    "value": [
                        {
                            "role": "assistant",
                            "content": assistant_response,
                        }
                    ],
                },
                "timestamps": {
                    "started_at": now_ms - 500,
                    "finished_at": now_ms,
                },
            }
        ],
        "metadata": {
            # =========================================
            # Reserved fields
            # =========================================
            "user_id": user_id,
            "thread_id": thread_id,
            "customer_id": customer_id,
            "labels": labels or [],
            # =========================================
            # Custom metadata — any other keys you want
            # =========================================
            **(custom_metadata or {}),
        },
    }

    response = requests.post(
        f"{LANGWATCH_ENDPOINT}/api/collector",
        headers={
            "X-Auth-Token": LANGWATCH_API_KEY,
            "Content-Type": "application/json",
        },
        json=payload,
    )

    print(f"  POST /api/collector -> {response.status_code}")
    return response


def main():
    print("LangWatch Metadata Example — REST API (Python)\n")
    print("Sends traces directly via HTTP without the LangWatch SDK.\n")
    print("=" * 50 + "\n")

    user_id = "user-12345"
    customer_id = "acme-corp"
    thread_id = f"conv-{uuid.uuid4().hex[:8]}"

    # First message
    print("Sending trace 1: 'What is the capital of France?'")
    send_trace_with_metadata(
        user_message="What is the capital of France?",
        assistant_response="The capital of France is Paris.",
        user_id=user_id,
        customer_id=customer_id,
        thread_id=thread_id,
        labels=["development", "tier-pro", "rest-api-example"],
        custom_metadata={
            "request_source": "cli-example",
            "sdk_version": "none (raw REST)",
        },
    )

    # Second message in same thread
    print("Sending trace 2: 'What about Germany?'")
    send_trace_with_metadata(
        user_message="What about Germany?",
        assistant_response="The capital of Germany is Berlin.",
        user_id=user_id,
        customer_id=customer_id,
        thread_id=thread_id,  # Same thread groups them together
        labels=["development", "tier-pro", "rest-api-example"],
        custom_metadata={
            "request_source": "cli-example",
            "sdk_version": "none (raw REST)",
        },
    )

    print("\n" + "=" * 50)
    print("\nCheck your LangWatch dashboard to see:")
    print("  - Both messages grouped under the same thread")
    print("  - User and customer IDs for filtering")
    print("  - Labels for categorization")
    print("  - Custom metadata in the trace details\n")


if __name__ == "__main__":
    main()
