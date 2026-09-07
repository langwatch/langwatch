"""
Unit tests for target registration in Evaluation class.
"""

import pytest
from langwatch.experiment.experiment import Experiment, TargetInfo


class TestTargetRegistration:
    """Tests for target registration functionality."""

    def test_register_target_with_metadata(self):
        """Registers a target with metadata on first log call."""
        evaluation = Experiment("test-experiment")

        # Register target via _register_target
        target_id = evaluation._register_target(
            "gpt4-baseline",
            metadata={"model": "openai/gpt-4", "temperature": 0.7},
        )

        assert target_id == "gpt4-baseline"
        assert "gpt4-baseline" in evaluation._targets
        assert evaluation._targets["gpt4-baseline"].metadata == {
            "model": "openai/gpt-4",
            "temperature": 0.7,
        }
        assert evaluation._targets["gpt4-baseline"].type == "custom"

    def test_register_target_without_metadata(self):
        """Registers a target without metadata."""
        evaluation = Experiment("test-experiment")

        target_id = evaluation._register_target("my-target")

        assert target_id == "my-target"
        assert "my-target" in evaluation._targets
        assert evaluation._targets["my-target"].metadata is None

    def test_subsequent_log_reuses_registered_target(self):
        """Subsequent calls with same target reuse the registration."""
        evaluation = Experiment("test-experiment")

        # First call registers
        target_id1 = evaluation._register_target(
            "gpt4", metadata={"model": "gpt-4"}
        )

        # Second call without metadata should work
        target_id2 = evaluation._register_target("gpt4")

        assert target_id1 == target_id2 == "gpt4"
        # Should still have original metadata
        assert evaluation._targets["gpt4"].metadata == {"model": "gpt-4"}

    def test_subsequent_log_with_same_metadata_works(self):
        """Subsequent calls with same metadata are allowed."""
        evaluation = Experiment("test-experiment")

        # First call
        evaluation._register_target("gpt4", metadata={"model": "gpt-4"})

        # Second call with same metadata should work
        evaluation._register_target("gpt4", metadata={"model": "gpt-4"})

        assert "gpt4" in evaluation._targets
        assert evaluation._targets["gpt4"].metadata == {"model": "gpt-4"}

    def test_conflicting_metadata_raises_error(self):
        """Raises error when providing different metadata for same target."""
        evaluation = Experiment("test-experiment")

        # First call registers with model=gpt-4
        evaluation._register_target("my-target", metadata={"model": "gpt-4"})

        # Second call with different metadata should fail
        with pytest.raises(ValueError) as exc_info:
            evaluation._register_target("my-target", metadata={"model": "claude-3"})

        error_message = str(exc_info.value)
        assert "my-target" in error_message
        assert "different metadata" in error_message
        assert "gpt-4" in error_message
        assert "claude-3" in error_message

    def test_multiple_targets_can_be_registered(self):
        """Multiple different targets can be registered."""
        evaluation = Experiment("test-experiment")

        evaluation._register_target("gpt4", metadata={"model": "openai/gpt-4"})
        evaluation._register_target("claude", metadata={"model": "anthropic/claude-3"})
        evaluation._register_target("llama", metadata={"model": "meta/llama-3"})

        assert len(evaluation._targets) == 3
        assert "gpt4" in evaluation._targets
        assert "claude" in evaluation._targets
        assert "llama" in evaluation._targets

    def test_targets_added_to_batch(self):
        """Registered targets are added to batch for sending."""
        evaluation = Experiment("test-experiment")

        evaluation._register_target("target-1", metadata={"v": 1})
        evaluation._register_target("target-2", metadata={"v": 2})

        assert len(evaluation.batch["targets"]) == 2
        target_ids = [t.id for t in evaluation.batch["targets"]]
        assert "target-1" in target_ids
        assert "target-2" in target_ids


class TestLogWithTarget:
    """Tests for log() method with target parameter."""

    def test_log_with_target_registers_it(self):
        """Calling log with target registers the target."""
        evaluation = Experiment("test-experiment")
        evaluation.initialized = True  # Skip init for unit test

        evaluation.log(
            metric="accuracy",
            index=0,
            score=0.95,
            target="gpt4-baseline",
            metadata={"model": "openai/gpt-4"},
        )

        assert "gpt4-baseline" in evaluation._targets
        assert evaluation._targets["gpt4-baseline"].metadata == {"model": "openai/gpt-4"}

    def test_log_without_target_works(self):
        """Calling log without target is backwards compatible."""
        evaluation = Experiment("test-experiment")
        evaluation.initialized = True

        evaluation.log(
            metric="accuracy",
            index=0,
            score=0.95,
        )

        # Should have no targets registered
        assert len(evaluation._targets) == 0
        # But evaluation should be added to batch
        assert len(evaluation.batch["evaluations"]) == 1
        assert evaluation.batch["evaluations"][0].target_id is None

    def test_log_with_target_sets_target_id(self):
        """Log with target sets target_id on the evaluation result."""
        evaluation = Experiment("test-experiment")
        evaluation.initialized = True

        evaluation.log(
            metric="accuracy",
            index=0,
            score=0.95,
            target="my-target",
        )

        assert len(evaluation.batch["evaluations"]) == 1
        assert evaluation.batch["evaluations"][0].target_id == "my-target"

    def test_log_multiple_metrics_for_same_target(self):
        """Multiple metrics can be logged for the same target."""
        evaluation = Experiment("test-experiment")
        evaluation.initialized = True

        evaluation.log(
            metric="accuracy",
            index=0,
            score=0.95,
            target="gpt4",
            metadata={"model": "gpt-4"},
        )
        evaluation.log(
            metric="latency",
            index=0,
            score=150,
            target="gpt4",  # Same target, no metadata needed
        )

        # Should have only one target registered
        assert len(evaluation._targets) == 1
        # But two evaluations
        assert len(evaluation.batch["evaluations"]) == 2
        assert all(e.target_id == "gpt4" for e in evaluation.batch["evaluations"])


class TestTargetInfoModel:
    """Tests for TargetInfo model."""

    def test_target_info_defaults(self):
        """TargetInfo has correct defaults."""
        target = TargetInfo(id="test", name="Test Target")

        assert target.id == "test"
        assert target.name == "Test Target"
        assert target.type == "custom"
        assert target.metadata is None

    def test_target_info_with_metadata(self):
        """TargetInfo can hold metadata."""
        target = TargetInfo(
            id="gpt4",
            name="GPT-4",
            metadata={"model": "openai/gpt-4", "temperature": 0.7, "use_cache": True},
        )

        assert target.metadata == {
            "model": "openai/gpt-4",
            "temperature": 0.7,
            "use_cache": True,
        }

    def test_target_info_serialization(self):
        """TargetInfo serializes correctly for API."""
        target = TargetInfo(
            id="test",
            name="Test",
            type="custom",
            metadata={"key": "value"},
        )

        serialized = target.model_dump(exclude_none=True, exclude_unset=True)

        assert serialized == {
            "id": "test",
            "name": "Test",
            "type": "custom",
            "metadata": {"key": "value"},
        }

    def test_target_info_serialization_without_optional_fields(self):
        """TargetInfo serializes correctly without optional fields."""
        target = TargetInfo(id="test", name="Test")

        serialized = target.model_dump(exclude_none=True)

        # type has a default so it's always included
        assert serialized == {
            "id": "test",
            "name": "Test",
            "type": "custom",
        }
