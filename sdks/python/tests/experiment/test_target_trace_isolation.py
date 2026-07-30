"""
Tests for trace isolation in evaluation.target() context manager.

These tests verify that each target() call creates an independent trace with a unique
trace_id, NOT shared across targets within the same dataset row.
"""

import json
import os
import time
import pandas as pd
import pytest
from concurrent.futures import ThreadPoolExecutor, as_completed
from unittest.mock import patch, MagicMock

import langwatch
from langwatch.experiment.experiment import (
    Experiment,
    _iteration_context,
    IterationContext,
)


@pytest.fixture(scope="module", autouse=True)
def setup_langwatch():
    """Setup langwatch with a test API key for the module."""
    # Set API key before setup
    os.environ["LANGWATCH_API_KEY"] = "test-key-for-tracing"
    langwatch._api_key = "test-key-for-tracing"
    langwatch._endpoint = "http://localhost:5560"
    
    # Only setup if not already configured
    try:
        langwatch.setup()
    except Exception:
        pass  # Already setup, ignore
    
    yield
    
    # Cleanup
    if "LANGWATCH_API_KEY" in os.environ:
        del os.environ["LANGWATCH_API_KEY"]


@pytest.fixture
def evaluation():
    """Create an evaluation instance with auto-send disabled."""
    ev = Experiment("test-trace-isolation")
    ev.initialized = True
    # Disable auto-sending during tests
    ev.last_sent = time.time() + 100000
    return ev


class TestTraceIdUniqueness:
    """Tests that verify each target() creates a unique trace_id."""

    def test_different_targets_same_row_have_different_trace_ids(self, evaluation):
        """Two targets for the same dataset row must have different trace_ids."""
        # Simulate being inside an iteration
        iter_ctx = IterationContext(index=0, item={"question": "Test?"})
        token = _iteration_context.set(iter_ctx)

        try:
            with evaluation.target("gpt-4"):
                pass  # Entry is created in finally block

            with evaluation.target("claude"):
                pass  # Entry is created in finally block
        finally:
            _iteration_context.reset(token)

        # Should have 2 entries with DIFFERENT trace_ids
        assert len(evaluation.batch["dataset"]) == 2
        
        gpt4_entry = [e for e in evaluation.batch["dataset"] if e.target_id == "gpt-4"][0]
        claude_entry = [e for e in evaluation.batch["dataset"] if e.target_id == "claude"][0]
        
        gpt4_trace = gpt4_entry.trace_id
        claude_trace = claude_entry.trace_id

        assert gpt4_trace != claude_trace, \
            f"Targets should have different trace_ids: gpt-4={gpt4_trace}, claude={claude_trace}"
        assert gpt4_trace != "", "GPT-4 trace_id should not be empty"
        assert claude_trace != "", "Claude trace_id should not be empty"
        # Also verify they're not all-zeros (no-op tracer)
        assert gpt4_trace != "00000000000000000000000000000000", "GPT-4 trace should not be no-op"
        assert claude_trace != "00000000000000000000000000000000", "Claude trace should not be no-op"

    def test_all_targets_all_rows_have_unique_trace_ids(self, evaluation):
        """Every (row, target) combination must have a unique trace_id."""
        for idx in range(3):
            iter_ctx = IterationContext(index=idx, item={"question": f"Q{idx}"})
            token = _iteration_context.set(iter_ctx)

            try:
                with evaluation.target("gpt-4"):
                    pass

                with evaluation.target("claude"):
                    pass
            finally:
                _iteration_context.reset(token)

        # Should have 6 entries (3 rows × 2 targets)
        assert len(evaluation.batch["dataset"]) == 6

        # All trace_ids should be unique
        all_ids = [e.trace_id for e in evaluation.batch["dataset"]]
        assert len(set(all_ids)) == 6, \
            f"Expected 6 unique trace_ids, got {len(set(all_ids))}: {all_ids}"


class TestTraceIdInHttpPayload:
    """Integration tests that verify trace_ids in the actual HTTP payload."""

    def test_http_payload_has_unique_trace_ids_per_target(self):
        """Mock HTTP and verify the payload has unique trace_ids."""
        captured_bodies = []

        def mock_post(*args, **kwargs):
            body = json.loads(kwargs.get("data", "{}"))
            captured_bodies.append(body)
            response = MagicMock()
            response.status_code = 200
            response.raise_for_status = MagicMock()
            return response

        evaluation = Experiment("test-trace-payload")
        evaluation.initialized = True

        df = pd.DataFrame([
            {"question": "Question A"},
            {"question": "Question B"},
        ])

        with patch("httpx.post", side_effect=mock_post):
            for index, row in evaluation.loop(df.iterrows(), threads=2):
                def run(index, row):
                    with evaluation.target("gpt-4"):
                        evaluation.log_response(f"GPT-4: {row['question']}")
                        time.sleep(0.01)

                    with evaluation.target("claude"):
                        evaluation.log_response(f"Claude: {row['question']}")
                        time.sleep(0.01)

                evaluation.submit(run, index, row)

        # Collect all dataset entries from HTTP calls
        all_entries = []
        for body in captured_bodies:
            all_entries.extend(body.get("dataset", []))

        # Should have 4 entries (2 rows × 2 targets)
        assert len(all_entries) == 4, f"Expected 4 entries, got {len(all_entries)}"

        # Group by index
        idx0 = [e for e in all_entries if e["index"] == 0]
        idx1 = [e for e in all_entries if e["index"] == 1]

        assert len(idx0) == 2, f"Index 0 should have 2 entries, got {len(idx0)}"
        assert len(idx1) == 2, f"Index 1 should have 2 entries, got {len(idx1)}"

        # Each index should have DIFFERENT trace_ids for different targets
        idx0_traces = [e["trace_id"] for e in idx0]
        idx1_traces = [e["trace_id"] for e in idx1]

        assert idx0_traces[0] != idx0_traces[1], \
            f"Index 0 targets should have different trace_ids: {idx0_traces}"
        assert idx1_traces[0] != idx1_traces[1], \
            f"Index 1 targets should have different trace_ids: {idx1_traces}"

        # All 4 trace_ids should be unique
        all_trace_ids = [e["trace_id"] for e in all_entries]
        assert len(set(all_trace_ids)) == 4, \
            f"All 4 trace_ids should be unique: {all_trace_ids}"
        
        # None should be all-zeros (no-op)
        for trace_id in all_trace_ids:
            assert trace_id != "00000000000000000000000000000000", \
                f"trace_id should not be no-op: {trace_id}"


class TestIterationTraceManagement:
    """Tests for the iteration trace closing behavior."""

    def test_evaluation_uses_targets_flag_set_on_first_target(self, evaluation):
        """_evaluation_uses_targets should be set True on first target() call."""
        assert evaluation._evaluation_uses_targets is False

        iter_ctx = IterationContext(index=0, item={"q": "test"})
        token = _iteration_context.set(iter_ctx)

        try:
            with evaluation.target("model1"):
                assert evaluation._evaluation_uses_targets is True
        finally:
            _iteration_context.reset(token)

        # Should remain True
        assert evaluation._evaluation_uses_targets is True

    def test_simple_loop_without_targets_creates_iteration_traces(self, evaluation):
        """Simple loop (no targets) should still create iteration-level traces."""
        # Don't use target() - just log directly
        for idx in range(2):
            iter_ctx = IterationContext(index=idx, item={"q": f"Q{idx}"})
            token = _iteration_context.set(iter_ctx)

            try:
                # Simulate what loop does without target()
                evaluation._current_iteration_used_with_target = False
                evaluation.log("metric", index=idx, score=0.5)
            finally:
                _iteration_context.reset(token)

        # The flag should NOT be set since we didn't use target()
        assert evaluation._evaluation_uses_targets is False


class TestConcurrentTargetTraceIsolation:
    """Tests for trace isolation in concurrent/parallel execution."""

    def test_concurrent_targets_have_unique_traces(self):
        """Parallel target() calls should each get unique trace_ids."""
        evaluation = Experiment("test-concurrent-traces")
        evaluation.initialized = True
        evaluation.last_sent = time.time() + 100000

        def run_target(idx, target_name):
            iter_ctx = IterationContext(index=idx, item={"q": f"Q{idx}"})
            token = _iteration_context.set(iter_ctx)

            try:
                with evaluation.target(target_name):
                    time.sleep(0.02)  # Simulate work
            finally:
                _iteration_context.reset(token)

        # Run multiple targets concurrently
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = []
            for idx in range(2):
                for target in ["gpt-4", "claude"]:
                    futures.append(executor.submit(run_target, idx, target))

            for f in as_completed(futures):
                f.result()

        # Should have 4 entries
        assert len(evaluation.batch["dataset"]) == 4

        # All trace_ids should be unique
        trace_ids = [e.trace_id for e in evaluation.batch["dataset"]]
        assert len(set(trace_ids)) == 4, \
            f"Expected 4 unique trace_ids in concurrent execution: {trace_ids}"
        
        # None should be all-zeros
        for trace_id in trace_ids:
            assert trace_id != "00000000000000000000000000000000", \
                f"trace_id should not be no-op: {trace_id}"
