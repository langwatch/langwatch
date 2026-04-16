"""
Unit tests for async-native experiment parallelism (aloop + asubmit).

These tests mirror the threading-path tests in test_target_trace_isolation.py and
test_with_target_integration.py, but exercise the new async-native execution mode
that keeps tasks on a single event loop so loop-bound singletons (gRPC channels,
ADK runners, Firestore clients) survive across items.
"""

import asyncio
import json
import os
import threading
import time
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

import langwatch
from langwatch.experiment.experiment import Experiment


@pytest.fixture(scope="module", autouse=True)
def setup_langwatch():
    prev_env_api_key = os.environ.get("LANGWATCH_API_KEY")
    prev_api_key = getattr(langwatch, "_api_key", None)
    prev_endpoint = getattr(langwatch, "_endpoint", None)

    os.environ["LANGWATCH_API_KEY"] = "test-key-for-async-tracing"
    langwatch._api_key = "test-key-for-async-tracing"
    langwatch._endpoint = "http://localhost:5560"
    try:
        langwatch.setup()
    except Exception:
        # Tracer may already be installed by a previous test module; reusing
        # the existing provider is fine for these tests since trace_ids are
        # what we assert, not exporter state.
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
def experiment(monkeypatch):
    ev = Experiment("test-async-experiment")
    ev.initialized = True
    # Stop any HTTP sending and preserve batch state for in-test inspection;
    # otherwise `_send_batch(finished=True)` at loop end wipes the batch.
    monkeypatch.setattr(ev, "_send_batch", lambda finished=False: None)
    monkeypatch.setattr(ev, "_auto_display_results", lambda: None)
    return ev


def _mock_http_capture():
    captured = []

    def mock_post(*args, **kwargs):
        body = json.loads(kwargs.get("data", "{}"))
        captured.append(body)
        response = MagicMock()
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    return captured, mock_post


@pytest.mark.unit
class TestAsyncLoopTraceIsolation:
    """Each concurrent item must run under its own isolated OTel trace."""

    @pytest.mark.asyncio
    async def test_each_item_gets_unique_trace_id(self, experiment):
        async def task(item):
            await asyncio.sleep(0.01)
            return item

        items = [{"q": f"Q{i}"} for i in range(10)]

        async for item in experiment.aloop(items, concurrency=4):
            experiment.asubmit(task, item)

        assert len(experiment.batch["dataset"]) == 10
        trace_ids = [entry.trace_id for entry in experiment.batch["dataset"]]
        assert len(set(trace_ids)) == 10, f"Expected 10 unique trace_ids, got {trace_ids}"
        for trace_id in trace_ids:
            assert trace_id
            assert trace_id != "00000000000000000000000000000000"

    @pytest.mark.asyncio
    async def test_iteration_index_does_not_leak_between_concurrent_tasks(
        self, experiment
    ):
        """Each asubmit task sees the index of its own item, not a sibling's."""
        from langwatch.experiment.experiment import _iteration_context

        observed: dict[int, int] = {}

        async def task(expected_index):
            await asyncio.sleep(0.02)
            ctx = _iteration_context.get()
            observed[expected_index] = ctx.index if ctx else -1

        items = list(range(6))
        async for idx in experiment.aloop(items, concurrency=6):
            experiment.asubmit(task, idx)

        # Every task should have observed its own index.
        assert observed == {i: i for i in range(6)}


@pytest.mark.unit
class TestAsyncLoopBoundResource:
    """Loop-bound resources created outside the loop must survive concurrent use."""

    @pytest.mark.asyncio
    async def test_shared_asyncio_event_is_usable_across_items(self, experiment):
        """An asyncio.Event created on the caller's loop must be awaitable by all items.

        Regression guard: under the threading path each thread creates a fresh event
        loop via asyncio.run(), so an Event created on the outer loop raises
        "Future attached to a different loop" when touched from a worker. Under the
        async-native path every task runs on the same loop so this just works.
        """
        gate = asyncio.Event()
        seen: list[int] = []

        async def task(item):
            await gate.wait()
            seen.append(item)

        items = list(range(8))

        async def driver():
            async for item in experiment.aloop(items, concurrency=8):
                experiment.asubmit(task, item)

        driver_task = asyncio.create_task(driver())
        # Give the loop a chance to spin up all waiters.
        await asyncio.sleep(0.05)
        gate.set()
        # Drain the driver so all submitted tasks have completed before we assert.
        _ = await driver_task

        assert sorted(seen) == items


@pytest.mark.unit
class TestAsyncConcurrencyBound:
    @pytest.mark.asyncio
    async def test_concurrency_limit_is_respected(self, experiment):
        in_flight = 0
        peak = 0
        lock = asyncio.Lock()

        async def task(_item):
            nonlocal in_flight, peak
            async with lock:
                in_flight += 1
                peak = max(peak, in_flight)
            await asyncio.sleep(0.02)
            async with lock:
                in_flight -= 1

        items = list(range(10))
        async for item in experiment.aloop(items, concurrency=3):
            experiment.asubmit(task, item)

        assert peak <= 3, f"Concurrency bound violated: saw {peak} in-flight"
        assert peak >= 2, f"Concurrency was not exercised: peak={peak}"


@pytest.mark.unit
class TestAsyncSyncCallable:
    """Sync callables in async mode must not block concurrent async siblings."""

    @pytest.mark.asyncio
    async def test_sync_callable_runs_off_main_thread(self, experiment):
        observed: dict[str, str] = {}

        def sync_worker(item):
            observed[f"sync-{item}"] = threading.current_thread().name
            time.sleep(0.05)

        async def async_worker(item):
            observed[f"async-{item}"] = threading.current_thread().name
            await asyncio.sleep(0.01)

        items = ["a", "b"]
        async for item in experiment.aloop(items, concurrency=2):
            # Alternate sync / async callables.
            if item == "a":
                experiment.asubmit(sync_worker, item)
            else:
                experiment.asubmit(async_worker, item)

        assert "sync-a" in observed and "async-b" in observed
        assert observed["sync-a"] != "MainThread", (
            "Sync callable should run in a worker thread via asyncio.to_thread, "
            f"but ran on {observed['sync-a']}"
        )
        assert observed["async-b"] == "MainThread", (
            "Async callable should run on the event loop thread, "
            f"but ran on {observed['async-b']}"
        )

    @pytest.mark.asyncio
    async def test_blocking_sync_callable_does_not_stall_async_sibling(self, experiment):
        """An async sibling must make progress while a sync callable is sleeping."""
        progress: list[str] = []

        def slow_sync(item):
            time.sleep(0.2)
            progress.append(f"sync-done-{item}")

        async def fast_async(item):
            await asyncio.sleep(0.01)
            progress.append(f"async-done-{item}")

        items = ["sync", "async"]
        start = time.time()
        async for item in experiment.aloop(items, concurrency=2):
            if item == "sync":
                experiment.asubmit(slow_sync, item)
            else:
                experiment.asubmit(fast_async, item)
        elapsed = time.time() - start

        # The async task finishing first proves it was not blocked behind the
        # sync callable. Under a naive implementation this list would end with
        # async-done after sync-done because everything ran sequentially.
        assert progress[0] == "async-done-async", (
            f"Async sibling did not overlap with sync callable: {progress}"
        )
        # If the sync callable blocked the loop the total time would jump to
        # ~0.2s anyway; if async-native parallelism is working the total time
        # is still ~0.2s (sync callable dominates) but overlap was demonstrated.
        assert elapsed < 0.35


@pytest.mark.unit
class TestAsyncFailureIsolation:
    @pytest.mark.asyncio
    async def test_one_failing_task_does_not_abort_siblings(self, experiment):
        async def task(item):
            if item["idx"] == 2:
                raise ValueError("boom")
            await asyncio.sleep(0.01)

        items = [{"idx": i} for i in range(5)]

        async for item in experiment.aloop(items, concurrency=3):
            experiment.asubmit(task, item)

        entries = experiment.batch["dataset"]
        assert len(entries) == 5

        failing = [e for e in entries if e.index == 2]
        assert len(failing) == 1
        assert failing[0].error is not None and "boom" in failing[0].error

        succeeding = [e for e in entries if e.index != 2]
        assert len(succeeding) == 4
        for e in succeeding:
            assert e.error is None


@pytest.mark.unit
class TestAsyncLoopEdgeCases:
    @pytest.mark.asyncio
    async def test_empty_iterable_completes_cleanly(self, experiment):
        """An empty iterable is a no-op but must not leave any state behind."""
        async for _ in experiment.aloop([], concurrency=4):
            raise AssertionError("should not yield for an empty iterable")

        assert experiment.batch["dataset"] == []
        assert experiment._async_tasks == []
        assert experiment._async_semaphore is None
        assert experiment._finished is True

    @pytest.mark.asyncio
    async def test_invalid_concurrency_raises(self, experiment):
        with pytest.raises(ValueError, match="concurrency must be >= 1"):
            async for _ in experiment.aloop([1, 2, 3], concurrency=0):
                pass
        with pytest.raises(ValueError, match="concurrency must be >= 1"):
            async for _ in experiment.aloop([1, 2, 3], concurrency=-1):
                pass

    @pytest.mark.asyncio
    async def test_asubmit_outside_aloop_raises(self, experiment):
        async def task(item):
            return item

        with pytest.raises(RuntimeError, match="aloop"):
            experiment.asubmit(task, "anything")

    @pytest.mark.asyncio
    async def test_early_break_with_aclose_cancels_pending_tasks(self, experiment):
        """Closing the aloop generator drains background work via its finally block.

        Python's `async for` does not automatically call `aclose()` on `break`
        (the generator stays alive until garbage collected), so callers who
        break early and need deterministic cleanup should hold the generator
        in a local variable and `await generator.aclose()` themselves. This
        test pins that contract.
        """
        started = asyncio.Event()
        cancelled: list[int] = []

        async def slow(item):
            if item == 0:
                started.set()
            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                cancelled.append(item)
                raise

        gen = experiment.aloop(range(10), concurrency=4)
        async for item in gen:
            experiment.asubmit(slow, item)
            if item == 0:
                await started.wait()
                break
        await gen.aclose()

        # Cleanup ran: state is reset so another aloop could be started.
        assert experiment._async_tasks == []
        assert experiment._async_semaphore is None
        # At least the first task was in-flight and got cancelled.
        assert 0 in cancelled


@pytest.mark.integration
class TestAsyncHttpPayload:
    """HTTP-mocked integration guard: batch payloads carry unique trace_ids per item."""

    @pytest.mark.asyncio
    async def test_batch_payload_contains_unique_trace_ids(self):
        captured, mock_post = _mock_http_capture()

        experiment = Experiment("test-async-batch")
        experiment.initialized = True

        df = pd.DataFrame([{"q": f"Question {i}"} for i in range(6)])

        async def task(row):
            await asyncio.sleep(0.005)

        with patch("httpx.post", side_effect=mock_post):
            async for _index, row in experiment.aloop(df.iterrows(), concurrency=3, total=6):
                experiment.asubmit(task, row)

        all_entries: list[dict] = []
        for body in captured:
            all_entries.extend(body.get("dataset", []))

        assert len(all_entries) == 6
        trace_ids = [e["trace_id"] for e in all_entries]
        assert len(set(trace_ids)) == 6, f"Expected 6 unique trace_ids: {trace_ids}"
        for trace_id in trace_ids:
            assert trace_id and trace_id != "00000000000000000000000000000000"

    @pytest.mark.asyncio
    async def test_final_batch_includes_finished_at(self):
        captured, mock_post = _mock_http_capture()

        experiment = Experiment("test-async-finished")
        experiment.initialized = True

        async def task(item):
            await asyncio.sleep(0.005)

        with patch("httpx.post", side_effect=mock_post):
            async for item in experiment.aloop([1, 2, 3], concurrency=2):
                experiment.asubmit(task, item)

        assert len(captured) >= 1
        # The final batch carries finished_at.
        final = next(
            body
            for body in reversed(captured)
            if isinstance(body.get("timestamps"), dict)
            and "finished_at" in body["timestamps"]
        )
        assert final["timestamps"]["finished_at"] > 0
