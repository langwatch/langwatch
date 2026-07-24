"""
Unit tests for target() context manager in Evaluation class.
"""

import pytest
import time
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
    ev._current_index = 0
    ev._current_item = {"question": "test"}
    # Set last_sent to far future to prevent automatic sending
    ev.last_sent = time.time() + 100000
    return ev


class TestTargetBasics:
    """Basic functionality tests for target()."""

    def test_target_creates_dataset_entry(self, evaluation):
        """target() creates a dataset entry with target_id."""
        evaluation._current_item = {"question": "What is AI?"}

        with evaluation.target("gpt-4", {"model": "openai/gpt-4"}):
            pass  # Just execute something

        # Should have one dataset entry with target_id
        assert len(evaluation.batch["dataset"]) == 1
        entry = evaluation.batch["dataset"][0]
        assert entry.target_id == "gpt-4"
        assert entry.index == 0

    def test_target_captures_duration(self, evaluation):
        """target() captures duration automatically."""
        with evaluation.target("gpt-4"):
            time.sleep(0.05)  # 50ms

        entry = evaluation.batch["dataset"][0]
        assert entry.duration >= 50  # At least 50ms

    def test_target_registers_target_with_metadata(self, evaluation):
        """target() registers the target with metadata."""
        with evaluation.target("gpt-4", {"model": "openai/gpt-4", "temp": 0.7}):
            pass

        assert "gpt-4" in evaluation._targets
        assert evaluation._targets["gpt-4"].metadata == {"model": "openai/gpt-4", "temp": 0.7}

    def test_target_stores_entry_data(self, evaluation):
        """target() stores the current item in the dataset entry."""
        evaluation._current_item = {"question": "What is AI?", "expected": "answer"}

        with evaluation.target("gpt-4"):
            pass

        entry = evaluation.batch["dataset"][0]
        # Dict items without to_dict() or __dict__ are serialized as JSON
        assert "entry" in entry.entry
        assert "What is AI?" in entry.entry["entry"]


class TestMultipleTargets:
    """Tests for using multiple targets in one iteration."""

    def test_multiple_targets_create_multiple_entries(self, evaluation):
        """Multiple target() calls create multiple dataset entries."""
        with evaluation.target("gpt-4", {"model": "openai/gpt-4"}):
            pass

        with evaluation.target("claude", {"model": "anthropic/claude"}):
            pass

        # Should have 2 dataset entries
        assert len(evaluation.batch["dataset"]) == 2

        target_ids = [e.target_id for e in evaluation.batch["dataset"]]
        assert "gpt-4" in target_ids
        assert "claude" in target_ids

    def test_targets_have_independent_durations(self, evaluation):
        """Each target captures its own duration."""
        with evaluation.target("fast-model"):
            time.sleep(0.02)  # 20ms

        with evaluation.target("slow-model"):
            time.sleep(0.05)  # 50ms

        fast_entry = next(e for e in evaluation.batch["dataset"] if e.target_id == "fast-model")
        slow_entry = next(e for e in evaluation.batch["dataset"] if e.target_id == "slow-model")

        # Slow should be slower than fast
        assert slow_entry.duration > fast_entry.duration


class TestContextInference:
    """Tests for target context inference in log() calls."""

    def test_log_infers_target_from_context(self, evaluation):
        """log() infers target from target() context."""
        with evaluation.target("gpt-4"):
            # Log without explicit target - should use context
            evaluation.log("quality", index=0, score=0.95)

        # Check the evaluation has the target_id from context
        assert len(evaluation.batch["evaluations"]) == 1
        assert evaluation.batch["evaluations"][0].target_id == "gpt-4"

    def test_log_explicit_target_overrides_context(self, evaluation):
        """log() with explicit target overrides context."""
        with evaluation.target("gpt-4"):
            # Log with explicit different target
            evaluation.log("quality", index=0, score=0.95, target="custom-target")

        assert evaluation.batch["evaluations"][0].target_id == "custom-target"

    def test_context_is_reset_after_target(self, evaluation):
        """Context is properly reset after exiting target()."""
        with evaluation.target("gpt-4"):
            # Inside context
            ctx = _target_context.get()
            assert ctx is not None
            assert ctx.target_id == "gpt-4"

        # Outside context
        ctx = _target_context.get()
        assert ctx is None

    def test_log_with_data_works_inside_target(self, evaluation):
        """log() with data= parameter works correctly inside target()."""
        with evaluation.target("gpt-4"):
            evaluation.log(
                "quality",
                index=0,
                score=0.95,
                data={"output": "AI response", "tokens": 150}
            )

        eval_result = evaluation.batch["evaluations"][0]
        assert eval_result.target_id == "gpt-4"
        assert eval_result.data == {"output": "AI response", "tokens": 150}


class TestRowLevelEntryPrevention:
    """Tests for preventing duplicate row-level dataset entries."""

    def test_target_sets_flag(self, evaluation):
        """target() sets _current_iteration_used_with_target flag."""
        assert evaluation._current_iteration_used_with_target is False

        with evaluation.target("gpt-4"):
            assert evaluation._current_iteration_used_with_target is True

    def test_flag_prevents_row_level_entry_in_loop(self, evaluation):
        """When flag is set, only target-specific entries exist."""
        # Use target - this sets the flag
        with evaluation.target("gpt-4"):
            pass

        # Only the target entry should exist, not a row-level one
        assert len(evaluation.batch["dataset"]) == 1
        assert evaluation.batch["dataset"][0].target_id == "gpt-4"


class TestErrorHandling:
    """Tests for error handling in target()."""

    def test_error_is_captured_in_entry(self, evaluation):
        """Errors inside target() are captured in the dataset entry."""
        with pytest.raises(ValueError):
            with evaluation.target("gpt-4"):
                raise ValueError("Test error")

        # Entry should still be created with error
        assert len(evaluation.batch["dataset"]) == 1
        assert evaluation.batch["dataset"][0].error == "Test error"

    def test_error_is_reraised(self, evaluation):
        """Errors are re-raised after cleanup."""
        with pytest.raises(ValueError, match="Test error"):
            with evaluation.target("gpt-4"):
                raise ValueError("Test error")

    def test_context_reset_on_error(self, evaluation):
        """Context is properly reset even when error occurs."""
        try:
            with evaluation.target("gpt-4"):
                raise ValueError("Test error")
        except ValueError:
            pass

        # Context should be reset
        assert _target_context.get() is None


class TestSimpleUsage:
    """Tests for the simplified API without result assignment."""

    def test_simple_target_usage(self, evaluation):
        """Simple usage without result assignment works."""
        with evaluation.target("gpt-4", {"model": "openai/gpt-4"}):
            # Simulate calling an LLM
            time.sleep(0.01)  # Add small delay for duration
            response = "This is the AI response"
            # Log the response and a metric
            evaluation.log_response(response)
            evaluation.log("quality", index=0, score=0.95)

        # Should have dataset entry with predicted
        assert len(evaluation.batch["dataset"]) == 1
        assert evaluation.batch["dataset"][0].target_id == "gpt-4"
        assert evaluation.batch["dataset"][0].duration >= 10  # At least 10ms
        assert evaluation.batch["dataset"][0].predicted == {"output": "This is the AI response"}

        # Should have evaluation
        assert len(evaluation.batch["evaluations"]) == 1

    def test_no_as_clause_needed(self, evaluation):
        """target() works without 'as' clause."""
        # This should work without "as result:"
        with evaluation.target("gpt-4"):
            evaluation.log("metric", index=0, score=1.0)

        assert len(evaluation.batch["dataset"]) == 1
        assert len(evaluation.batch["evaluations"]) == 1


class TestLogResponse:
    """Tests for log_response() method."""

    def test_log_response_string(self, evaluation):
        """log_response() with string wraps as {"output": ...}."""
        with evaluation.target("gpt-4"):
            evaluation.log_response("Hello, world!")

        assert evaluation.batch["dataset"][0].predicted == {"output": "Hello, world!"}

    def test_log_response_dict(self, evaluation):
        """log_response() with dict uses it as-is."""
        with evaluation.target("gpt-4"):
            evaluation.log_response({"answer": "42", "confidence": 0.95})

        assert evaluation.batch["dataset"][0].predicted == {"answer": "42", "confidence": 0.95}

    def test_log_response_outside_target_creates_implicit_output_target(self, evaluation):
        """log_response() outside target() creates an implicit 'Output' target."""
        # Set up iteration context (normally done by loop())
        from langwatch.experiment.experiment import _iteration_context, _target_context, IterationContext
        iter_ctx = IterationContext(index=0, item={"question": "test"})
        iter_token = _iteration_context.set(iter_ctx)

        try:
            evaluation.log_response("Hello, world!")

            # Should create a dataset entry with target_id "Output"
            assert len(evaluation.batch["dataset"]) == 1
            entry = evaluation.batch["dataset"][0]
            assert entry.target_id == "Output"
            assert entry.predicted == {"output": "Hello, world!"}
            assert entry.index == 0

            # Should register the "Output" target
            assert "Output" in evaluation._targets
        finally:
            _iteration_context.reset(iter_token)
            # Reset target context to avoid polluting other tests
            _target_context.set(None)

    def test_log_response_outside_target_associates_log_with_output_target(self, evaluation):
        """log() after log_response() outside target uses the implicit 'Output' target."""
        from langwatch.experiment.experiment import _iteration_context, _target_context, IterationContext
        iter_ctx = IterationContext(index=0, item={"question": "test"})
        iter_token = _iteration_context.set(iter_ctx)

        try:
            evaluation.log_response("Hello, world!")
            evaluation.log("quality", index=0, score=0.95)

            # log() should use the implicit "Output" target
            assert len(evaluation.batch["evaluations"]) == 1
            assert evaluation.batch["evaluations"][0].target_id == "Output"
        finally:
            _iteration_context.reset(iter_token)
            # Reset target context to avoid polluting other tests
            _target_context.set(None)

    def test_log_response_with_multiple_metrics(self, evaluation):
        """log_response() works alongside multiple log() calls."""
        with evaluation.target("gpt-4"):
            evaluation.log_response("AI response")
            evaluation.log("accuracy", index=0, score=0.95)
            evaluation.log("latency", index=0, score=150)
            evaluation.log("cost", index=0, score=0.001)

        # One dataset entry with predicted
        assert len(evaluation.batch["dataset"]) == 1
        assert evaluation.batch["dataset"][0].predicted == {"output": "AI response"}

        # Three evaluations
        assert len(evaluation.batch["evaluations"]) == 3


class TestImplicitTargetContextReset:
    """Tests to ensure implicit target context is properly reset between iterations."""

    def test_implicit_target_context_reset_between_iterations(self):
        """Context from log_response() in one iteration doesn't pollute the next."""
        from langwatch.experiment.experiment import (
            Experiment,
            _iteration_context,
            _target_context,
            IterationContext,
        )

        ev = Experiment("test-context-reset")
        ev.initialized = True
        ev.last_sent = 9999999999  # Prevent sending

        # First iteration with log_response (creates implicit Output target)
        iter_ctx1 = IterationContext(index=0, item={"question": "q1"})
        with ev._execute_item_iteration(0, {"question": "q1"}, in_thread=False):
            ev.log_response("response 1")
            ev.log("metric", index=0, score=0.5)

        # Context should be reset after iteration
        assert _target_context.get() is None, "Target context should be reset after iteration"

        # Second iteration WITHOUT log_response - should not inherit Output target
        with ev._execute_item_iteration(1, {"question": "q2"}, in_thread=False):
            # log() without log_response should NOT have a target
            ev.log("metric", index=1, score=0.6)

        # Check the evaluations
        evals = ev.batch["evaluations"]
        assert len(evals) == 2
        assert evals[0].target_id == "Output"  # First iteration used implicit target
        assert evals[1].target_id is None  # Second iteration should have no target

    def test_multiple_iterations_with_log_response_each_get_own_entry(self):
        """Each iteration with log_response creates its own dataset entry."""
        from langwatch.experiment.experiment import Experiment, _target_context

        ev = Experiment("test-multi-iterations")
        ev.initialized = True
        ev.last_sent = 9999999999

        # Run 3 iterations, each with log_response
        for i in range(3):
            with ev._execute_item_iteration(i, {"question": f"q{i}"}, in_thread=False):
                ev.log_response(f"response {i}")
                ev.log("metric", index=i, score=0.5 + i * 0.1)

        # Should have 3 dataset entries
        assert len(ev.batch["dataset"]) == 3
        for i, entry in enumerate(ev.batch["dataset"]):
            assert entry.target_id == "Output"
            assert entry.predicted == {"output": f"response {i}"}
            assert entry.index == i

        # Should have 3 evaluations, all with Output target
        assert len(ev.batch["evaluations"]) == 3
        for i, eval_result in enumerate(ev.batch["evaluations"]):
            assert eval_result.target_id == "Output"
            assert eval_result.index == i

    def test_run_without_log_response_after_run_with_log_response(self):
        """A run without log_response after a run with log_response should work correctly."""
        from langwatch.experiment.experiment import Experiment, _target_context

        # Simulate first run with log_response
        ev1 = Experiment("test-first-run")
        ev1.initialized = True
        ev1.last_sent = 9999999999

        for i in range(2):
            with ev1._execute_item_iteration(i, {"q": f"q{i}"}, in_thread=False):
                ev1.log_response(f"response {i}")
                ev1.log("metric", index=i, score=0.5)

        # Context should be clean after first experiment
        assert _target_context.get() is None

        # Simulate second run WITHOUT log_response (like the user's second scenario)
        ev2 = Experiment("test-second-run")
        ev2.initialized = True
        ev2.last_sent = 9999999999

        for i in range(2):
            with ev2._execute_item_iteration(i, {"q": f"q{i}"}, in_thread=False):
                # Just log, no log_response
                ev2.log("metric", index=i, score=0.6)

        # Second run evaluations should NOT have Output target
        for eval_result in ev2.batch["evaluations"]:
            assert eval_result.target_id is None, "Second run should not inherit Output target"
