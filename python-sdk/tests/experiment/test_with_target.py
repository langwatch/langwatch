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

    def test_log_response_outside_target_raises(self, evaluation):
        """log_response() outside target() raises RuntimeError."""
        with pytest.raises(RuntimeError, match="must be called inside a target"):
            evaluation.log_response("test")

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
