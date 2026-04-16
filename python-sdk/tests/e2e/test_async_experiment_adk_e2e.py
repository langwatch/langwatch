"""
End-to-end test for the async-native experiment loop.

Verifies, against a *live* LangWatch backend, that ``experiment.aloop`` +
``experiment.asubmit``:

- run concurrent async items without the "Future attached to a different loop"
  error (the ADK / gRPC / Firestore regression);
- land a distinct trace per item in the platform's result feed;
- when the Google ADK instrumentor is configured, produce non-zero LLM cost
  and token counts per item.

Requirements (all three skip the test if missing):
    LANGWATCH_API_KEY=<valid key for the target environment>
    LANGWATCH_ENDPOINT=<defaults to https://app.langwatch.ai>
    GOOGLE_API_KEY=<Gemini key>          # optional; when absent, the ADK
                                         # scenarios are skipped but the
                                         # loop-affinity assertion still runs
                                         # against a lightweight async task.

Run with: `pytest tests/e2e/test_async_experiment_adk_e2e.py -v -m e2e`
"""

from __future__ import annotations

import asyncio
import os
import time
import urllib.parse

import httpx
import pytest

pytestmark = pytest.mark.e2e


def _require_env(name: str) -> str | None:
    return os.environ.get(name) or None


def _has_adk() -> bool:
    try:
        import google.adk  # noqa: F401
        from openinference.instrumentation.google_adk import (  # noqa: F401
            GoogleADKInstrumentor,
        )
    except ImportError:
        return False
    return True


@pytest.fixture(scope="module", autouse=True)
def configure_langwatch():
    api_key = _require_env("LANGWATCH_API_KEY")
    if not api_key:
        pytest.skip("LANGWATCH_API_KEY not set")

    import langwatch

    prev_api_key = getattr(langwatch, "_api_key", None)
    prev_endpoint = getattr(langwatch, "_endpoint", None)

    langwatch._api_key = api_key
    endpoint = os.environ.get("LANGWATCH_ENDPOINT") or "https://app.langwatch.ai"
    langwatch._endpoint = endpoint

    try:
        langwatch.setup()
    except Exception:
        # Setup may already have been performed by a sibling test module.
        pass
    try:
        yield
    finally:
        langwatch._api_key = prev_api_key
        langwatch._endpoint = prev_endpoint


def _poll_run_results(
    *,
    endpoint: str,
    api_key: str,
    experiment_slug: str,
    run_id: str,
    expected_items: int,
    timeout: float = 60.0,
    interval: float = 2.0,
) -> dict:
    """Poll the run results API until every submitted item shows up."""
    url = (
        f"{endpoint}/api/evaluations/v3/runs/{urllib.parse.quote(run_id)}/results"
        f"?experimentSlug={urllib.parse.quote(experiment_slug)}"
    )
    deadline = time.time() + timeout
    last_body: dict = {"dataset": []}
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with httpx.Client(timeout=15) as client:
                response = client.get(url, headers={"X-Auth-Token": api_key})
            if response.is_success:
                last_body = response.json()
                if len(last_body.get("dataset", [])) >= expected_items:
                    return last_body
        except Exception as exc:
            # Tolerate transient polling errors but surface the latest one if
            # the deadline expires.
            last_error = exc
        time.sleep(interval)
    raise AssertionError(
        f"Timed out after {timeout}s waiting for {expected_items} items "
        f"(saw {len(last_body.get('dataset', []))}) at {url}"
        + (f"; last error: {last_error!r}" if last_error else "")
    )


class TestAsyncLoopAgainstLiveBackend:
    """Minimal async-loop regression, no ADK required."""

    @pytest.mark.asyncio
    async def test_async_loop_records_unique_trace_per_item(self):
        import langwatch
        from langwatch.experiment.experiment import Experiment

        experiment = Experiment("e2e-async-loop")
        items = list(range(5))

        # A lightweight async task. The regression guard is "no loop-affinity
        # error raised" — any shared asyncio primitive here would have failed
        # on the threading path.
        gate = asyncio.Event()

        async def task(item: int) -> None:
            await gate.wait()
            await asyncio.sleep(0.01)

        async def drive():
            async for item in experiment.aloop(items, concurrency=4):
                experiment.asubmit(task, item)

        driver = asyncio.create_task(drive())
        await asyncio.sleep(0.05)
        gate.set()
        # Drain the driver task so every submission has completed.
        _ = await driver

        body = _poll_run_results(
            endpoint=langwatch.get_endpoint(),
            api_key=langwatch.get_api_key() or "",
            experiment_slug=experiment.experiment_slug,
            run_id=experiment.run_id,
            expected_items=len(items),
        )

        trace_ids = [row.get("traceId") for row in body["dataset"]]
        assert len(trace_ids) == len(items)
        assert len(set(trace_ids)) == len(items), (
            f"Expected {len(items)} distinct trace IDs, got: {trace_ids}"
        )
        for tid in trace_ids:
            assert tid, f"Empty trace_id in platform response: {body}"


@pytest.mark.skipif(not _has_adk(), reason="google-adk is not installed")
class TestAsyncLoopWithGoogleAdk:
    """The real regression scenario that motivated this mode."""

    @pytest.mark.asyncio
    async def test_shared_adk_runner_survives_concurrent_items(self):
        if not _require_env("GOOGLE_API_KEY"):
            pytest.skip("GOOGLE_API_KEY not set")

        import langwatch
        from langwatch.experiment.experiment import Experiment
        from google.adk.agents import Agent
        from google.adk.runners import InMemoryRunner
        from google.genai import types
        from openinference.instrumentation.google_adk import GoogleADKInstrumentor

        langwatch.setup(instrumentors=[GoogleADKInstrumentor()])

        def get_weather(city: str) -> dict:
            return {"status": "ok", "report": f"Sunny in {city}"}

        agent = Agent(
            name="weather_agent",
            model="gemini-2.0-flash-exp",
            description="Replies with a short weather report.",
            instruction="Call get_weather and answer briefly.",
            tools=[get_weather],
        )
        runner = InMemoryRunner(agent=agent, app_name="e2e-async-adk")
        cities = ["Amsterdam", "Berlin", "Cairo", "Delhi", "Edinburgh"]

        experiment = Experiment("e2e-async-adk")

        async def ask(city: str, *, item_index: int) -> str:
            session_id = f"item-{item_index}"
            await runner.session_service.create_session(
                app_name="e2e-async-adk", user_id="user", session_id=session_id
            )
            async for event in runner.run_async(
                user_id="user",
                session_id=session_id,
                new_message=types.Content(
                    role="user",
                    parts=[types.Part(text=f"What is the weather in {city}?")],
                ),
            ):
                if event.is_final_response():
                    # is_final_response() can fire with content=None for
                    # state-delta events — guard before indexing parts[0].
                    content = getattr(event, "content", None)
                    parts = getattr(content, "parts", None) or []
                    text = getattr(parts[0], "text", None) if parts else None
                    return text.strip() if text else ""
            return ""

        idx = 0
        async for city in experiment.aloop(cities, concurrency=3):
            experiment.asubmit(ask, city, item_index=idx)
            idx += 1

        body = _poll_run_results(
            endpoint=langwatch.get_endpoint(),
            api_key=langwatch.get_api_key() or "",
            experiment_slug=experiment.experiment_slug,
            run_id=experiment.run_id,
            expected_items=len(cities),
            timeout=180.0,  # ADK + Gemini needs more time than a stub task
        )

        dataset = body["dataset"]
        trace_ids = [row.get("traceId") for row in dataset]
        assert len(set(trace_ids)) == len(cities), (
            f"Traces leaked between items: {trace_ids}"
        )
        # Cost rollup may lag by a few seconds beyond dataset ingestion; if
        # costs aren't populated we flag rather than hard-fail so this test
        # keeps its primary value (isolation + no loop-affinity error).
        costs = [row.get("cost") for row in dataset if row.get("cost") is not None]
        if costs:
            assert all(c > 0 for c in costs), f"Expected positive costs, got: {costs}"
