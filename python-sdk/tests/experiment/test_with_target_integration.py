"""
Integration tests for target() context manager with parallel execution.
"""

import pytest
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from unittest.mock import patch, MagicMock
from langwatch.experiment.experiment import (
    Experiment,
    _target_context,
)


@pytest.fixture
def evaluation():
    """Create an evaluation that won't send batches during tests."""
    ev = Experiment("test-experiment")
    ev.initialized = True
    # Set last_sent to far future to prevent automatic sending
    ev.last_sent = time.time() + 100000
    return ev


class TestParallelTarget:
    """Tests for target() in parallel execution scenarios."""

    def test_context_isolation_between_threads(self, evaluation):
        """Each thread has isolated target context."""
        contexts_seen: dict[str, list[str]] = {"thread-a": [], "thread-b": []}

        def worker_a():
            evaluation._current_index = 0
            evaluation._current_item = {"question": "test"}
            with evaluation.target("target-a"):
                # Record what context we see
                ctx = _target_context.get()
                contexts_seen["thread-a"].append(ctx.target_id if ctx else "none")
                time.sleep(0.05)  # Overlap with thread B
                # Check again after sleep
                ctx = _target_context.get()
                contexts_seen["thread-a"].append(ctx.target_id if ctx else "none")

        def worker_b():
            time.sleep(0.01)  # Start slightly after A
            evaluation._current_index = 0
            evaluation._current_item = {"question": "test"}
            with evaluation.target("target-b"):
                ctx = _target_context.get()
                contexts_seen["thread-b"].append(ctx.target_id if ctx else "none")
                time.sleep(0.05)
                ctx = _target_context.get()
                contexts_seen["thread-b"].append(ctx.target_id if ctx else "none")

        # Run in separate threads
        t1 = threading.Thread(target=worker_a)
        t2 = threading.Thread(target=worker_b)

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Each thread should only ever see its own target
        assert contexts_seen["thread-a"] == ["target-a", "target-a"]
        assert contexts_seen["thread-b"] == ["target-b", "target-b"]

    def test_parallel_targets_create_separate_entries(self, evaluation):
        """Parallel target calls create their own dataset entries."""
        results: list[str] = []

        def run_target(target_name: str, delay: float):
            evaluation._current_index = 0
            evaluation._current_item = {"question": "test"}
            with evaluation.target(target_name):
                time.sleep(delay)
            results.append(target_name)

        # Run targets in parallel
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(run_target, "gpt-4", 0.03),
                executor.submit(run_target, "claude", 0.02),
                executor.submit(run_target, "llama", 0.01),
            ]
            for f in as_completed(futures):
                f.result()

        # All three should have completed
        assert len(results) == 3

        # All three dataset entries should exist
        assert len(evaluation.batch["dataset"]) == 3

        target_ids = [e.target_id for e in evaluation.batch["dataset"]]
        assert "gpt-4" in target_ids
        assert "claude" in target_ids
        assert "llama" in target_ids

    def test_log_in_parallel_target_uses_correct_context(self, evaluation):
        """log() inside parallel target blocks uses correct target."""
        logged_targets: list[str] = []

        # Patch log to capture what targets are used
        original_log = evaluation.log

        def tracking_log(*args, **kwargs):
            # Get target from context or explicit
            ctx = _target_context.get()
            target = kwargs.get("target") or (ctx.target_id if ctx else None)
            logged_targets.append(target or "none")
            return original_log(*args, **kwargs)

        evaluation.log = tracking_log

        def worker(target_name: str):
            evaluation._current_index = 0
            evaluation._current_item = {"question": "test"}
            with evaluation.target(target_name):
                # Log without explicit target - should use context
                evaluation.log("quality", index=0, score=0.9)
                time.sleep(0.02)  # Ensure overlap
                evaluation.log("latency", index=0, score=100)

        # Run in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(worker, "gpt-4"),
                executor.submit(worker, "claude"),
            ]
            for f in as_completed(futures):
                f.result()

        # Should have 4 logs (2 per target)
        assert len(logged_targets) == 4
        # Each should be one of the targets (no cross-contamination)
        assert all(t in ["gpt-4", "claude"] for t in logged_targets)

    def test_parallel_execution_captures_independent_durations(self, evaluation):
        """Each parallel target captures its own duration independently."""

        def run_target(target_name: str, delay: float):
            evaluation._current_index = 0
            evaluation._current_item = {"question": "test"}
            with evaluation.target(target_name):
                time.sleep(delay)

        start = time.time()

        # Run with different delays in parallel
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(run_target, "fast", 0.01),  # 10ms
                executor.submit(run_target, "medium", 0.03),  # 30ms
                executor.submit(run_target, "slow", 0.05),  # 50ms
            ]
            for f in as_completed(futures):
                f.result()

        total_time = time.time() - start

        # Total time should be ~50ms (parallel), not 90ms (sequential)
        assert total_time < 0.08  # Allow some overhead

        # Check individual durations
        entries = {e.target_id: e for e in evaluation.batch["dataset"]}
        assert entries["fast"].duration < entries["medium"].duration
        assert entries["medium"].duration < entries["slow"].duration
        assert entries["slow"].duration >= 50  # At least 50ms


class TestTargetInSubmit:
    """Tests for target() used inside evaluation.submit()."""

    def test_target_in_submit_creates_entries(self):
        """target inside submit() creates proper dataset entries."""
        evaluation = Experiment("test-experiment")
        evaluation.initialized = True
        evaluation.last_sent = time.time() + 100000

        # Simulate the loop context
        evaluation._current_index = 0
        evaluation._current_item = {"question": "What is AI?"}

        def worker():
            evaluation._current_index = 0
            evaluation._current_item = {"question": "What is AI?"}
            with evaluation.target("gpt-4", {"model": "openai/gpt-4"}):
                time.sleep(0.01)
                evaluation.log("quality", index=0, score=0.9, data={"output": "GPT-4 response"})

            with evaluation.target("claude", {"model": "anthropic/claude"}):
                time.sleep(0.01)
                evaluation.log("quality", index=0, score=0.85, data={"output": "Claude response"})

        # Simulate what evaluation.submit would do
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(worker)
            future.result()

        # Should have 2 dataset entries, one per target
        assert len(evaluation.batch["dataset"]) == 2

        target_ids = {e.target_id for e in evaluation.batch["dataset"]}
        assert target_ids == {"gpt-4", "claude"}

        # Should have 2 evaluations with data
        assert len(evaluation.batch["evaluations"]) == 2
        gpt4_eval = next(e for e in evaluation.batch["evaluations"] if e.target_id == "gpt-4")
        claude_eval = next(e for e in evaluation.batch["evaluations"] if e.target_id == "claude")

        assert gpt4_eval.data == {"output": "GPT-4 response"}
        assert claude_eval.data == {"output": "Claude response"}


class TestBackwardsCompatibility:
    """Tests ensuring existing behavior still works."""

    def test_loop_without_target_creates_row_entry(self, evaluation):
        """Using loop without target still creates row-level entries."""
        # Simulate iteration behavior
        evaluation._current_iteration_used_with_target = False
        evaluation._current_index = 0
        evaluation._current_item = {"question": "test"}

        # Just log without target
        evaluation.log("quality", index=0, score=0.95)

        # Should have evaluation but no dataset entry (dataset entry is created by loop)
        assert len(evaluation.batch["evaluations"]) == 1
        assert evaluation.batch["evaluations"][0].target_id is None

    def test_explicit_target_in_log_still_works(self, evaluation):
        """Explicit target parameter in log() still works."""
        evaluation._current_index = 0
        evaluation._current_item = {"question": "test"}

        # Log with explicit target (old API)
        evaluation.log(
            "quality",
            index=0,
            score=0.95,
            target="my-target",
            metadata={"model": "gpt-4"},
        )

        assert len(evaluation.batch["evaluations"]) == 1
        assert evaluation.batch["evaluations"][0].target_id == "my-target"
        assert "my-target" in evaluation._targets


class TestRaceConditionPrevention:
    """Tests ensuring _current_item is captured correctly in parallel execution."""

    def test_parallel_targets_capture_correct_item_data(self, evaluation):
        """Each target() captures its own item data, not the last one processed.

        This test reproduces the bug where all dataset entries end up with the
        same entry data (the last item) because _current_item is a shared
        instance variable that gets overwritten by other threads.
        """
        items_processed: list[dict] = []

        def run_for_item(item_data: dict, index: int):
            # Simulate what happens in evaluation.submit()
            evaluation._current_index = index
            evaluation._current_item = item_data

            with evaluation.target(f"target-{index}"):
                # Sleep to create opportunity for race condition
                time.sleep(0.05)
                items_processed.append({"index": index, "item": item_data})

        # Run multiple items in parallel - this is where the bug manifests
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(run_for_item, {"question": "Question A"}, 0),
                executor.submit(run_for_item, {"question": "Question B"}, 1),
                executor.submit(run_for_item, {"question": "Question C"}, 2),
            ]
            for f in as_completed(futures):
                f.result()

        # All 3 entries should exist
        assert len(evaluation.batch["dataset"]) == 3

        # Each entry should have its OWN item data, not all the same
        entries_by_target = {e.target_id: e for e in evaluation.batch["dataset"]}

        # This is the critical assertion that catches the bug:
        # Without the fix, all entries would have "Question C" (the last one)
        assert "Question A" in str(entries_by_target["target-0"].entry), \
            f"target-0 should have Question A, got: {entries_by_target['target-0'].entry}"
        assert "Question B" in str(entries_by_target["target-1"].entry), \
            f"target-1 should have Question B, got: {entries_by_target['target-1'].entry}"
        assert "Question C" in str(entries_by_target["target-2"].entry), \
            f"target-2 should have Question C, got: {entries_by_target['target-2'].entry}"

    def test_parallel_targets_capture_correct_index(self, evaluation):
        """Each target() captures its own index, not the last one set."""

        def run_for_item(item_data: dict, index: int):
            evaluation._current_index = index
            evaluation._current_item = item_data

            with evaluation.target(f"model-{index}"):
                time.sleep(0.03)  # Create race condition opportunity

        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(run_for_item, {"q": "A"}, 0),
                executor.submit(run_for_item, {"q": "B"}, 1),
                executor.submit(run_for_item, {"q": "C"}, 2),
            ]
            for f in as_completed(futures):
                f.result()

        # Each entry should have correct index matching its target
        entries_by_target = {e.target_id: e for e in evaluation.batch["dataset"]}

        assert entries_by_target["model-0"].index == 0
        assert entries_by_target["model-1"].index == 1
        assert entries_by_target["model-2"].index == 2

    def test_multiple_targets_per_item_with_real_loop_and_submit(self):
        """Multiple target() calls using real evaluation.loop() and submit() pattern.

        This test reproduces the ACTUAL bug from the notebook where when running
        multiple targets per dataset item using evaluation.loop() + submit(),
        only the first target's dataset entries are created, not all targets.

        The bug: evaluation.submit() calls _execute_item_iteration which sets
        iteration context, but multiple target() calls within the same submitted
        function should all use that same iteration context.
        """
        import pandas as pd
        import json
        from unittest.mock import patch, MagicMock
        import langwatch

        # Mock HTTP to capture what gets sent
        captured_bodies = []

        def mock_post(*args, **kwargs):
            body = json.loads(kwargs.get("data", "{}"))
            captured_bodies.append(body)
            response = MagicMock()
            response.status_code = 200
            response.raise_for_status = MagicMock()
            return response

        # Setup langwatch
        langwatch._api_key = "test-key"
        langwatch._endpoint = "http://localhost:5560"

        # Create evaluation
        evaluation = Experiment("test-multi-target")
        evaluation.initialized = True

        # Create test dataset
        df = pd.DataFrame([
            {"question": "Question A"},
            {"question": "Question B"},
            {"question": "Question C"},
        ])

        with patch("httpx.post", side_effect=mock_post):
            for index, row in evaluation.loop(df.iterrows(), threads=3):
                def task(index, row):
                    # First target
                    with evaluation.target("gpt-4"):
                        evaluation.log_response(f"GPT-4 response for {row['question']}")
                        time.sleep(0.02)

                    # Second target - this is where the bug manifests
                    with evaluation.target("claude"):
                        evaluation.log_response(f"Claude response for {row['question']}")
                        time.sleep(0.02)

                evaluation.submit(task, index, row)

        # Collect all dataset entries from captured HTTP calls
        all_dataset_entries = []
        for body in captured_bodies:
            all_dataset_entries.extend(body.get("dataset", []))

        # Should have 6 dataset entries (3 items × 2 targets)
        assert len(all_dataset_entries) == 6, \
            f"Expected 6 dataset entries, got {len(all_dataset_entries)}"

        # Group by target
        gpt4_entries = [e for e in all_dataset_entries if e.get("target_id") == "gpt-4"]
        claude_entries = [e for e in all_dataset_entries if e.get("target_id") == "claude"]

        assert len(gpt4_entries) == 3, f"Expected 3 GPT-4 entries, got {len(gpt4_entries)}"
        assert len(claude_entries) == 3, f"Expected 3 Claude entries, got {len(claude_entries)}"

        # Each target should have entries for all 3 indices
        gpt4_indices = {e["index"] for e in gpt4_entries}
        claude_indices = {e["index"] for e in claude_entries}

        assert gpt4_indices == {0, 1, 2}, f"GPT-4 indices: {gpt4_indices}"
        assert claude_indices == {0, 1, 2}, f"Claude indices: {claude_indices}"

        # Check predicted values match the correct question
        for entry in gpt4_entries:
            expected_question = df.iloc[entry["index"]]["question"]
            assert expected_question in str(entry.get("predicted")), \
                f"GPT-4 entry at index {entry['index']} has wrong predicted: {entry.get('predicted')}"

        for entry in claude_entries:
            expected_question = df.iloc[entry["index"]]["question"]
            assert expected_question in str(entry.get("predicted")), \
                f"Claude entry at index {entry['index']} has wrong predicted: {entry.get('predicted')}"
