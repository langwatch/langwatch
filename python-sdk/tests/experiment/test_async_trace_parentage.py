"""
Trace-parentage + threading-parity tests for the async-native experiment loop.

These close the "are the traces connected?" and "does async behave like threading?"
gaps that unit-level assertions on `batch["dataset"]` can't cover. We capture
real OpenTelemetry spans via an in-memory exporter and assert on their
trace/parent relationships directly.
"""

import asyncio
import json
import os
import time
from typing import Sequence
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from opentelemetry import trace as trace_api
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)

import langwatch
from langwatch.experiment.experiment import Experiment


pytestmark = pytest.mark.unit


class RecordingExporter(SpanExporter):
    def __init__(self):
        self.spans: list[ReadableSpan] = []

    def export(self, spans: Sequence[ReadableSpan]):
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS


@pytest.fixture(scope="module", autouse=True)
def setup_langwatch():
    prev_env_api_key = os.environ.get("LANGWATCH_API_KEY")
    prev_api_key = getattr(langwatch, "_api_key", None)
    prev_endpoint = getattr(langwatch, "_endpoint", None)

    os.environ["LANGWATCH_API_KEY"] = "test-key-for-parentage"
    langwatch._api_key = "test-key-for-parentage"
    langwatch._endpoint = "http://localhost:5560"
    try:
        langwatch.setup()
    except Exception:
        pass
    try:
        yield
    finally:
        if prev_env_api_key is None:
            os.environ.pop("LANGWATCH_API_KEY", None)
        else:
            os.environ["LANGWATCH_API_KEY"] = prev_env_api_key
        langwatch._api_key = prev_api_key
        langwatch._endpoint = prev_endpoint


@pytest.fixture
def exporter():
    recorder = RecordingExporter()
    provider = trace_api.get_tracer_provider()
    if not hasattr(provider, "add_span_processor"):
        trace_api.set_tracer_provider(trace_sdk.TracerProvider())
        provider = trace_api.get_tracer_provider()
    provider.add_span_processor(SimpleSpanProcessor(recorder))
    return recorder


@pytest.fixture
def experiment(monkeypatch):
    ev = Experiment("test-parentage-experiment")
    ev.initialized = True
    monkeypatch.setattr(ev, "_send_batch", lambda finished=False: None)
    monkeypatch.setattr(ev, "_auto_display_results", lambda: None)
    return ev


def _trace_id_hex(span: ReadableSpan) -> str:
    return f"{span.get_span_context().trace_id:032x}"


class TestTraceParentage:
    """When user code creates a nested span inside asubmit, it must be a child of
    the iteration trace, not detached into its own root trace."""

    @pytest.mark.asyncio
    async def test_nested_span_in_asubmit_is_child_of_iteration_trace(
        self, experiment, exporter
    ):
        """Reproduces the OTel context-propagation question: an instrumentor
        (ADK, OpenAI, LangChain) called inside `asubmit`'s task creates spans
        via `trace.get_tracer(...)`. Those spans must carry the iteration
        trace's trace_id and be children of its root span."""
        tracer = trace_api.get_tracer(__name__)

        async def task(item):
            # This mirrors what an instrumentor does — grab the current tracer
            # and open a span inside the user's task code.
            with tracer.start_as_current_span(f"inner-{item}"):
                await asyncio.sleep(0.005)

        items = list(range(4))
        async for item in experiment.aloop(items, concurrency=4):
            experiment.asubmit(task, item)

        inner_spans = [s for s in exporter.spans if s.name.startswith("inner-")]
        assert len(inner_spans) == 4, (
            f"Expected 4 inner spans, got {[s.name for s in inner_spans]}"
        )

        # Group inner spans by trace_id. Each should share a trace with an
        # iteration/target root span from the same item.
        inner_by_trace = {_trace_id_hex(s): s for s in inner_spans}
        assert len(inner_by_trace) == 4, (
            "Inner spans share trace IDs — isolation broken"
        )

        # For each inner span, there must be ANOTHER span in the same trace
        # whose span_id matches inner.parent. That's the iteration/target
        # root the instrumentor was supposed to nest under.
        for inner in inner_spans:
            parent_span_id = inner.parent.span_id if inner.parent else 0
            assert parent_span_id != 0, (
                f"Inner span {inner.name} has no parent — detached from iteration trace"
            )
            # Find the parent in the exported spans.
            same_trace = [
                s
                for s in exporter.spans
                if _trace_id_hex(s) == _trace_id_hex(inner)
                and s.get_span_context().span_id == parent_span_id
            ]
            assert len(same_trace) == 1, (
                f"Parent of {inner.name} (span_id={parent_span_id:016x}) not in same trace"
            )

    @pytest.mark.asyncio
    async def test_concurrent_nested_spans_do_not_leak_between_items(
        self, experiment, exporter
    ):
        """Two items' inner spans must never share a trace_id, even when they
        run on overlapping timeslices on the same event-loop thread."""
        tracer = trace_api.get_tracer(__name__)
        gate = asyncio.Event()

        async def task(item):
            # Hold both tasks at the gate so they're active simultaneously
            # under the same asyncio scheduler before emitting a nested span.
            await gate.wait()
            with tracer.start_as_current_span(f"inner-{item}"):
                await asyncio.sleep(0)

        async def drive():
            async for item in experiment.aloop([1, 2], concurrency=2):
                experiment.asubmit(task, item)

        driver = asyncio.create_task(drive())
        await asyncio.sleep(0.02)
        gate.set()
        await driver

        inner_by_name = {s.name: _trace_id_hex(s) for s in exporter.spans if s.name.startswith("inner-")}
        assert set(inner_by_name.keys()) == {"inner-1", "inner-2"}
        assert inner_by_name["inner-1"] != inner_by_name["inner-2"], (
            "Concurrent items leaked into the same trace"
        )


class TestThreadingAsyncParity:
    """Running the same workload through `loop`/`submit` and `aloop`/`asubmit`
    must produce equivalent batch output. No drift, no regression."""

    def test_batch_shape_parity_between_threading_and_async(self):
        captured_threading = []
        captured_async = []

        def mock_post_factory(bucket):
            def mock_post(*args, **kwargs):
                bucket.append(json.loads(kwargs.get("data", "{}")))
                response = MagicMock()
                response.status_code = 200
                response.raise_for_status = MagicMock()
                return response
            return mock_post

        df = pd.DataFrame([{"q": f"Q{i}"} for i in range(6)])

        # Threading path
        ev_t = Experiment("parity-threading")
        ev_t.initialized = True
        with patch("httpx.post", side_effect=mock_post_factory(captured_threading)):
            for index, row in ev_t.loop(df.iterrows(), threads=3):
                def task_t(index, row):
                    time.sleep(0.005)
                ev_t.submit(task_t, index, row)

        # Async path
        async def run_async():
            ev_a = Experiment("parity-async")
            ev_a.initialized = True

            async def task_a(row):
                await asyncio.sleep(0.005)

            with patch("httpx.post", side_effect=mock_post_factory(captured_async)):
                async for _index, row in ev_a.aloop(df.iterrows(), concurrency=3, total=6):
                    ev_a.asubmit(task_a, row)

        asyncio.run(run_async())

        entries_t = [e for body in captured_threading for e in body.get("dataset", [])]
        entries_a = [e for body in captured_async for e in body.get("dataset", [])]

        assert len(entries_t) == 6
        assert len(entries_a) == 6

        # Index coverage identical.
        assert sorted(e["index"] for e in entries_t) == [0, 1, 2, 3, 4, 5]
        assert sorted(e["index"] for e in entries_a) == [0, 1, 2, 3, 4, 5]

        # Every trace_id is unique in both.
        assert len({e["trace_id"] for e in entries_t}) == 6
        assert len({e["trace_id"] for e in entries_a}) == 6

        # No trace_id cross-contamination between the two paths.
        assert set(e["trace_id"] for e in entries_t).isdisjoint(
            e["trace_id"] for e in entries_a
        )

        # Neither path produced a no-op zero trace.
        for entries in (entries_t, entries_a):
            for e in entries:
                assert e["trace_id"] != "00000000000000000000000000000000"


class TestAsyncLoopDataFrame:
    """Callers commonly iterate a pandas DataFrame directly. This was covered
    in the threading path and must work unchanged under `aloop`."""

    @pytest.mark.asyncio
    async def test_aloop_accepts_dataframe_iterrows(self, experiment):
        df = pd.DataFrame([{"q": f"Q{i}"} for i in range(5)])
        seen_questions: list[str] = []

        async def task(row):
            seen_questions.append(row["q"])

        async for _index, row in experiment.aloop(
            df.iterrows(), concurrency=2, total=5
        ):
            experiment.asubmit(task, row)

        assert sorted(seen_questions) == ["Q0", "Q1", "Q2", "Q3", "Q4"]
        # Every item produced a batch entry with a trace_id.
        assert len(experiment.batch["dataset"]) == 5
        assert len({e.trace_id for e in experiment.batch["dataset"]}) == 5
