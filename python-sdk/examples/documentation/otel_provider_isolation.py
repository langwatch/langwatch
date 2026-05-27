"""
Running LangWatch alongside another OTel-based SDK (e.g. an APM or
error-monitoring tool).

Problem: Both SDKs hook into the same global TracerProvider, so all
spans flow to both — LLM traces appear in the other tool and
application traces appear in LangWatch.

Solution: Pass a dedicated TracerProvider to langwatch.setup() so
LangWatch uses its own isolated provider while the other SDK keeps
the global one.
"""

import langwatch
from openai import OpenAI
from opentelemetry.sdk.trace import TracerProvider

# 1. The other OTel SDK initializes first and sets the global provider.
#    (This happens automatically when you import/init the other SDK.)

# 2. Create a dedicated provider for LangWatch.
langwatch_provider = TracerProvider()

# 3. Pass it to langwatch.setup() — LangWatch attaches its exporter
#    to this provider and leaves the global provider untouched.
langwatch.setup(tracer_provider=langwatch_provider)

client = OpenAI()


@langwatch.trace(name="isolated-chat")
async def chat(user_message: str):
    langwatch.get_current_trace().autotrack_openai_calls(client)

    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[{"role": "user", "content": user_message}],
    )
    return response.choices[0].message.content


async def main():
    reply = await chat("Explain OTel in one sentence.")
    print(reply)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
