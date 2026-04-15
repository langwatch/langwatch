"""Tests for Experiment.results DataFrame building from platform data."""

import pandas as pd
import pytest
from langwatch.experiment.experiment import Experiment
from langwatch.experiment.platform_run import (
    ExperimentRunResult,
    ExperimentRunSummary,
    EvaluatorStats,
)


class TestBuildDfFromPlatform:
    """when building a DataFrame from platform API response"""

    def test_single_target_produces_flat_dataframe(self):
        data = {
            "dataset": [
                {
                    "index": 0,
                    "entry": {"question": "what is AI?"},
                    "traceId": "trace_abc",
                    "duration": 1200,
                    "cost": 0.003,
                    "predicted": {"output": "AI is..."},
                },
                {
                    "index": 1,
                    "entry": {"question": "what is ML?"},
                    "traceId": "trace_def",
                    "duration": 800,
                },
            ],
            "evaluations": [
                {
                    "index": 0,
                    "name": "quality",
                    "evaluator": "quality",
                    "score": 0.95,
                    "status": "processed",
                },
                {
                    "index": 1,
                    "name": "quality",
                    "evaluator": "quality",
                    "score": 0.70,
                    "status": "processed",
                },
            ],
        }

        df = Experiment._build_df_from_platform(data)

        assert len(df) == 2
        assert df.index.name == "index"
        assert "question" in df.columns
        assert "trace_id" in df.columns
        assert "duration_ms" in df.columns
        assert "quality" in df.columns
        assert "cost" in df.columns
        assert df.loc[0, "quality"] == 0.95
        assert df.loc[1, "quality"] == 0.70
        assert df.loc[0, "cost"] == 0.003
        assert df.loc[0, "output"] == "AI is..."

    def test_multi_target_uses_target_as_top_level_index(self):
        data = {
            "dataset": [
                {"index": 0, "entry": {"q": "a"}, "traceId": "t1", "duration": 100, "targetId": "gpt-4"},
                {"index": 0, "entry": {"q": "a"}, "traceId": "t2", "duration": 200, "targetId": "claude"},
            ],
            "evaluations": [
                {"index": 0, "name": "score", "evaluator": "score", "targetId": "gpt-4", "score": 0.9, "status": "processed"},
                {"index": 0, "name": "score", "evaluator": "score", "targetId": "claude", "score": 0.8, "status": "processed"},
            ],
        }

        df = Experiment._build_df_from_platform(data)

        assert isinstance(df.index, pd.MultiIndex)
        assert df.index.names == ["target", "index"]
        assert ("claude", 0) in df.index
        assert ("gpt-4", 0) in df.index
        assert df.loc[("gpt-4", 0), "score"] == 0.9
        assert df.loc[("claude", 0), "score"] == 0.8

    def test_empty_dataset_returns_empty_dataframe(self):
        df = Experiment._build_df_from_platform({"dataset": [], "evaluations": []})
        assert df.empty

    def test_includes_cost_duration_trace_id(self):
        data = {
            "dataset": [
                {"index": 0, "entry": {}, "traceId": "t1", "duration": 500, "cost": 0.01},
            ],
            "evaluations": [],
        }

        df = Experiment._build_df_from_platform(data)

        assert df.loc[0, "trace_id"] == "t1"
        assert df.loc[0, "duration_ms"] == 500
        assert df.loc[0, "cost"] == 0.01

    def test_includes_predicted_output(self):
        data = {
            "dataset": [
                {"index": 0, "entry": {}, "traceId": "t1", "duration": 100, "predicted": {"output": "hello"}},
            ],
            "evaluations": [],
        }

        df = Experiment._build_df_from_platform(data)
        assert df.loc[0, "output"] == "hello"

    def test_multiple_evaluators_create_separate_columns(self):
        data = {
            "dataset": [
                {"index": 0, "entry": {"q": "test"}, "traceId": "t1", "duration": 100},
            ],
            "evaluations": [
                {"index": 0, "name": "faithfulness", "evaluator": "f", "score": 0.9, "status": "processed"},
                {"index": 0, "name": "toxicity", "evaluator": "t", "score": 0.1, "passed": True, "status": "processed"},
            ],
        }

        df = Experiment._build_df_from_platform(data)

        assert df.loc[0, "faithfulness"] == 0.9
        assert df.loc[0, "toxicity"] == 0.1
        assert df.loc[0, "toxicity_passed"] == True

    def test_errors_included_in_dataframe(self):
        data = {
            "dataset": [
                {"index": 0, "entry": {}, "traceId": "t1", "duration": 100, "error": "timeout"},
            ],
            "evaluations": [],
        }

        df = Experiment._build_df_from_platform(data)
        assert df.loc[0, "error"] == "timeout"


class TestExperimentRepr:
    """when displaying experiment objects"""

    def test_repr_shows_status_and_progress(self):
        e = Experiment.__new__(Experiment)
        e.name = "my-experiment"
        e.experiment_slug = "my-experiment"
        e.run_id = "abc123"
        e.total = 10
        e.progress = 7
        e.initialized = True
        e._finished = False
        e._run_url = None
        e._cached_results_df = None

        assert "my-experiment" in repr(e)
        assert "running" in repr(e)
        assert "7/10" in repr(e)

    def test_repr_shows_finished(self):
        e = Experiment.__new__(Experiment)
        e.name = "test"
        e.experiment_slug = "test"
        e.run_id = "abc"
        e.total = 5
        e.progress = 5
        e.initialized = True
        e._finished = True
        e._run_url = None
        e._cached_results_df = None

        assert "finished" in repr(e)


class TestExperimentRunResultRepr:
    """when displaying ExperimentRunResult"""

    def test_repr_shows_summary(self):
        result = ExperimentRunResult(
            run_id="abc",
            status="completed",
            passed=8,
            failed=2,
            pass_rate=80.0,
            duration=5000,
            run_url="https://example.com",
            summary=ExperimentRunSummary(
                run_id="abc",
                total_cells=10,
                completed_cells=10,
                failed_cells=2,
                duration=5000,
            ),
        )

        r = repr(result)
        assert "OK" in r
        assert "80.0%" in r
        assert "5.0s" in r

    def test_to_dataframe_with_evaluators(self):
        result = ExperimentRunResult(
            run_id="abc",
            status="completed",
            passed=8,
            failed=2,
            pass_rate=80.0,
            duration=5000,
            run_url="",
            summary=ExperimentRunSummary(
                run_id="abc",
                total_cells=10,
                completed_cells=10,
                failed_cells=2,
                duration=5000,
                evaluators=[
                    EvaluatorStats("e1", "Faithfulness", 8, 2, 80.0, 0.85),
                    EvaluatorStats("e2", "Toxicity", 10, 0, 100.0, 0.05),
                ],
            ),
        )

        df = result.to_dataframe()
        assert len(df) == 2
        assert "evaluator" in df.columns
        assert df.iloc[0]["evaluator"] == "Faithfulness"
        assert df.iloc[0]["pass_rate"] == 80.0
