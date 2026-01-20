"""
End-to-End tests for platform experiments (Experiments Workbench) runner.

These tests require:
- LANGWATCH_ENDPOINT set (or defaults to production)
- LANGWATCH_API_KEY set with a valid API key
- A saved experiment with slug (set via TEST_EXPERIMENT_SLUG env var)
"""

import os
from dotenv import load_dotenv

load_dotenv()

import pytest

import langwatch
from langwatch.experiment import run, ExperimentRunResult
from langwatch.experiment.platform_run import (
    ExperimentNotFoundError,
    ExperimentsApiError,
)


@pytest.mark.e2e
class TestErrorHandling:
    def test_raises_experiment_not_found_for_non_existent_slug(self):
        with pytest.raises(ExperimentNotFoundError) as exc_info:
            run("non-existent-experiment-slug-12345")
        assert "non-existent-experiment-slug-12345" in str(exc_info.value)

    def test_raises_api_error_with_invalid_api_key(self):
        with pytest.raises(ExperimentsApiError) as exc_info:
            run(
                os.environ.get("TEST_EXPERIMENT_SLUG", "test-experiment"),
                api_key="invalid-api-key",
            )
        assert exc_info.value.status_code == 401


@pytest.mark.e2e
class TestRunExperiment:
    @pytest.mark.skipif(
        not os.environ.get("TEST_EXPERIMENT_SLUG"),
        reason="TEST_EXPERIMENT_SLUG not set",
    )
    def test_runs_experiment_and_returns_results(self):
        slug = os.environ.get("TEST_EXPERIMENT_SLUG", "test-experiment")
        result = run(
            slug,
            timeout=300,  # 5 minutes
            on_progress=lambda completed, total: print(f"Progress: {completed}/{total}"),
        )

        assert isinstance(result, ExperimentRunResult)
        assert result.run_id
        assert result.status in ("completed", "failed", "stopped")
        assert isinstance(result.passed, int)
        assert isinstance(result.failed, int)
        assert isinstance(result.pass_rate, float)
        assert isinstance(result.duration, int)
        assert result.run_url
        assert result.summary is not None
        # Check that print_summary method exists
        assert callable(result.print_summary)

    @pytest.mark.skipif(
        not os.environ.get("TEST_EXPERIMENT_SLUG"),
        reason="TEST_EXPERIMENT_SLUG not set",
    )
    def test_reports_progress_during_execution(self):
        slug = os.environ.get("TEST_EXPERIMENT_SLUG", "test-experiment")
        progress_updates: list[tuple[int, int]] = []

        result = run(
            slug,
            timeout=300,
            on_progress=lambda completed, total: progress_updates.append(
                (completed, total)
            ),
        )

        # Should have received at least one progress update
        assert len(progress_updates) > 0

        # Progress should increase (or stay same)
        for i in range(1, len(progress_updates)):
            assert progress_updates[i][0] >= progress_updates[i - 1][0]
