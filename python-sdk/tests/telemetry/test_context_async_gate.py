"""
Gating tests for langwatch.telemetry.context.

The module maintains a global ``main_thread_langwatch_trace`` / ``_span`` list as
a fallback so that worker threads spawned via ``ThreadPoolExecutor`` can still
see the parent's active trace when ``contextvars`` didn't propagate. Under the
async-native path every ``asyncio.Task`` gets its own ``contextvars`` copy, and
that shared list becomes a trace-leakage hazard between sibling tasks on the
same thread. These tests pin the gating in place.
"""

import asyncio
import threading

import pytest

from langwatch.telemetry import context as ctx_mod


class TestAsyncLoopDetection:
    def test_not_on_loop_outside_asyncio(self):
        assert ctx_mod._is_on_async_loop() is False

    @pytest.mark.asyncio
    async def test_on_loop_inside_asyncio(self):
        assert ctx_mod._is_on_async_loop() is True

    @pytest.mark.asyncio
    async def test_not_on_loop_inside_to_thread_worker(self):
        """asyncio.to_thread spawns OS threads that have no running loop."""

        def probe() -> bool:
            return ctx_mod._is_on_async_loop()

        observed = await asyncio.to_thread(probe)
        assert observed is False


class TestGlobalListNotMutatedFromAsync:
    """The main-thread global fallback must stay untouched while the loop runs."""

    @pytest.mark.asyncio
    async def test_set_current_trace_skips_global_list_on_async_loop(self):
        before = list(ctx_mod.main_thread_langwatch_trace)

        sentinel = object()
        ctx_mod._set_current_trace(sentinel)  # type: ignore[arg-type]

        try:
            assert ctx_mod.main_thread_langwatch_trace == before, (
                "main_thread_langwatch_trace must not be appended while "
                "inside a running asyncio loop"
            )
        finally:
            # Reset the contextvar; there's nothing to pop from the global list.
            ctx_mod.stored_langwatch_trace.set(None)  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_set_current_span_skips_global_list_on_async_loop(self):
        before = list(ctx_mod.main_thread_langwatch_span)

        sentinel = object()
        ctx_mod._set_current_span(sentinel)  # type: ignore[arg-type]

        assert ctx_mod.main_thread_langwatch_span == before


class TestThreadingPathStillWorks:
    """Outside any event loop the original threading behaviour is preserved."""

    def test_set_current_trace_appends_to_global_list_on_main_thread(self):
        # Ensure clean start: this runs in a sync test, no asyncio loop active.
        before = list(ctx_mod.main_thread_langwatch_trace)

        sentinel = object()
        ctx_mod._set_current_trace(sentinel)  # type: ignore[arg-type]

        try:
            assert ctx_mod.main_thread_langwatch_trace[-1] is sentinel
        finally:
            # Undo the append so other tests aren't polluted.
            if ctx_mod.main_thread_langwatch_trace[-1:] == [sentinel]:
                ctx_mod.main_thread_langwatch_trace.pop()
            assert list(ctx_mod.main_thread_langwatch_trace) == before

    def test_child_thread_reads_main_fallback_when_contextvar_missing(self):
        """In the pure-threading path, a child thread can still see the main's trace."""
        ctx_mod.main_thread_langwatch_trace.clear()
        ctx_mod.main_thread_langwatch_trace.append("SENTINEL_TRACE")  # type: ignore[arg-type]

        seen: list = []

        def worker():
            seen.append(ctx_mod.stored_langwatch_trace.get(None))
            if (
                ctx_mod._is_on_child_thread()
                and not ctx_mod._is_on_async_loop()
                and ctx_mod.main_thread_langwatch_trace
            ):
                seen.append(ctx_mod.main_thread_langwatch_trace[-1])

        t = threading.Thread(target=worker)
        t.start()
        t.join()

        ctx_mod.main_thread_langwatch_trace.clear()

        assert seen[0] is None  # contextvar not inherited in a raw Thread
        assert seen[-1] == "SENTINEL_TRACE"
