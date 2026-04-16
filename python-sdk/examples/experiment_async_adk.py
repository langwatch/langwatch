"""Run a LangWatch experiment over a Google ADK agent using the async-native loop.

This example demonstrates `experiment.aloop` + `experiment.asubmit` — the async
sibling of the threading-based `experiment.loop` / `experiment.submit` pair.

Why async? Google ADK's `InMemoryRunner` binds a gRPC channel to the event loop
it was created on. Under the threading path each worker runs its coroutine with
`asyncio.run(...)`, which spins up a *new* loop per thread and breaks that
binding ("Future attached to a different loop"). The async-native path keeps
every item on the caller's loop, so singletons and factories that open expensive
connections once stay usable across items.

Requirements:
    pip install "langwatch" google-adk openinference-instrumentation-google-adk
    export LANGWATCH_API_KEY=...
    export GOOGLE_API_KEY=...  # Gemini key

Run it:
    python examples/experiment_async_adk.py
"""

from __future__ import annotations

import asyncio
import os
import sys

import langwatch
from langwatch.experiment.experiment import Experiment


def _require_env(var: str) -> str:
    value = os.environ.get(var)
    if not value:
        print(f"error: environment variable {var} is not set", file=sys.stderr)
        sys.exit(2)
    return value


async def run() -> None:
    _require_env("LANGWATCH_API_KEY")
    _require_env("GOOGLE_API_KEY")

    # Imports kept local so the example's top-level import list doesn't fail
    # when google-adk isn't installed.
    from google.adk.agents import Agent
    from google.adk.runners import InMemoryRunner
    from google.genai import types
    from openinference.instrumentation.google_adk import GoogleADKInstrumentor

    langwatch.setup(instrumentors=[GoogleADKInstrumentor()])

    def get_weather(city: str) -> dict:
        forecasts = {
            "new york": "Sunny, 25C",
            "london": "Cloudy, 18C",
            "tokyo": "Rainy, 22C",
            "berlin": "Windy, 16C",
            "sao paulo": "Humid, 27C",
        }
        city = city.lower().strip()
        if city in forecasts:
            return {"status": "ok", "report": forecasts[city]}
        return {"status": "error", "message": f"no forecast for {city!r}"}

    agent = Agent(
        name="weather_agent",
        model="gemini-2.0-flash-exp",
        description="Replies with a short weather report when asked about a city.",
        instruction="Use the get_weather tool, then answer briefly.",
        tools=[get_weather],
    )

    # Singleton that would blow up under the threading path because its gRPC
    # channel is bound to *this* event loop.
    runner = InMemoryRunner(agent=agent, app_name="experiment-async-adk")

    cities = [
        "New York",
        "London",
        "Tokyo",
        "Berlin",
        "Sao Paulo",
        "New York",
        "London",
        "Tokyo",
        "Berlin",
        "Sao Paulo",
    ]

    experiment = Experiment("async-adk-example")

    async def ask(city: str, *, item_index: int) -> str:
        # A dedicated session per item keeps multi-turn state isolated even when
        # the same runner is shared across concurrent items.
        session_id = f"item-{item_index}"
        await runner.session_service.create_session(
            app_name="experiment-async-adk", user_id="user", session_id=session_id
        )
        async for event in runner.run_async(
            user_id="user",
            session_id=session_id,
            new_message=types.Content(
                role="user", parts=[types.Part(text=f"What is the weather in {city}?")]
            ),
        ):
            if event.is_final_response():
                return event.content.parts[0].text.strip()
        return ""

    item_index = 0
    async for city in experiment.aloop(cities, concurrency=4):
        experiment.asubmit(ask, city, item_index=item_index)
        item_index += 1

    print(f"\nDone. View the run at: {experiment._run_url}")


if __name__ == "__main__":
    asyncio.run(run())
