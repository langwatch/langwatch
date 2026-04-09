"""
End-to-End tests for platform experiments (Experiments Workbench) runner.

These tests require:
- LANGWATCH_ENDPOINT set (or defaults to production)
- LANGWATCH_API_KEY set with a valid API key
- A saved experiment with slug (set via TEST_EXPERIMENT_SLUG env var)
"""

import os
from dotenv import load_dotenv
from unittest.mock import patch, MagicMock

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
    def test_runs_experiment_and_returns_results(self):
        with patch("langwatch.experiment.platform_run._start_run") as mock_start, \
             patch("langwatch.experiment.platform_run._get_run_status") as mock_status, \
             patch("langwatch.experiment.platform_run.get_endpoint", return_value="http://localhost:3000"), \
             patch("langwatch.experiment.platform_run.langwatch") as mock_lw:
            mock_lw.ensure_setup = MagicMock()

            mock_start.return_value = {
                "runId": "run-123",
                "total": 10,
                "runUrl": "http://app.langwatch.ai/project/runs/run-123",
            }

            mock_status.side_effect = [
                {"status": "running", "progress": 5, "total": 10},
                {
                    "status": "completed",
                    "progress": 10,
                    "total": 10,
                    "summary": {
                        "totalCells": 10,
                        "completedCells": 10,
                        "failedCells": 2,
                        "duration": 5000,
                        "totalPassed": 8,
                        "totalFailed": 2,
                        "passRate": 80.0,
                        "targets": [
                            {
                                "targetId": "t1",
                                "name": "Target 1",
                                "passed": 8,
                                "failed": 2,
                                "avgLatency": 150.0,
                                "totalCost": 0.01,
                            }
                        ],
                        "evaluators": [
                            {
                                "evaluatorId": "e1",
                                "name": "Evaluator 1",
                                "passed": 8,
                                "failed": 2,
                                "passRate": 80.0,
                                "avgScore": 0.8,
                            }
                        ],
                    },
                },
            ]

            result = run(
                "test-experiment",
                api_key="test-key",
                timeout=300,
                poll_interval=0.01,
                on_progress=lambda completed, total: None,
            )

        assert isinstance(result, ExperimentRunResult)
        assert result.run_id == "run-123"
        assert result.status in ("completed", "failed", "stopped")
        assert isinstance(result.passed, int)
        assert isinstance(result.failed, int)
        assert isinstance(result.pass_rate, float)
        assert isinstance(result.duration, int)
        assert result.run_url
        assert result.summary is not None
        assert callable(result.print_summary)

    def test_reports_progress_during_execution(self):
        progress_updates: list[tuple[int, int]] = []

        with patch("langwatch.experiment.platform_run._start_run") as mock_start, \
             patch("langwatch.experiment.platform_run._get_run_status") as mock_status, \
             patch("langwatch.experiment.platform_run.get_endpoint", return_value="http://localhost:3000"), \
             patch("langwatch.experiment.platform_run.langwatch") as mock_lw:
            mock_lw.ensure_setup = MagicMock()

            mock_start.return_value = {
                "runId": "run-456",
                "total": 10,
                "runUrl": "http://app.langwatch.ai/project/runs/run-456",
            }

            mock_status.side_effect = [
                {"status": "running", "progress": 3, "total": 10},
                {"status": "running", "progress": 7, "total": 10},
                {
                    "status": "completed",
                    "progress": 10,
                    "total": 10,
                    "summary": {
                        "totalCells": 10,
                        "completedCells": 10,
                        "failedCells": 0,
                        "duration": 3000,
                        "totalPassed": 10,
                        "totalFailed": 0,
                        "passRate": 100.0,
                    },
                },
            ]

            result = run(
                "test-experiment",
                api_key="test-key",
                timeout=300,
                poll_interval=0.01,
                on_progress=lambda completed, total: progress_updates.append(
                    (completed, total)
                ),
            )

        # Should have received progress updates (initial 0 + each poll)
        assert len(progress_updates) > 0

        # Progress should increase (or stay same)
        for i in range(1, len(progress_updates)):
            assert progress_updates[i][0] >= progress_updates[i - 1][0]
