"""Tests for Experiment.print_summary — parity with ExperimentRunResult.print_summary."""

import io
from contextlib import redirect_stdout
from unittest.mock import patch

import pandas as pd
import pytest

from langwatch.experiment.experiment import Experiment

pytestmark = pytest.mark.unit


def _experiment_with_df(df: pd.DataFrame, run_url: str = "https://app.langwatch.ai/runs/xyz") -> Experiment:
    exp = Experiment(name="ci-quality-check", run_id="run_abc")
    exp._cached_results_df = df
    exp._run_url = run_url
    return exp


class TestBuildRunResult:
    """given an Experiment with a cached results DataFrame"""

    def test_empty_dataframe_yields_zero_counts(self):
        exp = _experiment_with_df(pd.DataFrame())

        result = exp._build_run_result()

        assert result.passed == 0
        assert result.failed == 0
        assert result.pass_rate == 0.0
        assert result.status == "completed"
        assert result.run_id == "run_abc"

    def test_counts_passed_and_failed_from_passed_columns(self):
        df = pd.DataFrame(
            {
                "index": [0, 1, 2],
                "faithfulness": [0.9, 0.5, 0.8],
                "faithfulness_passed": [True, False, True],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        result = exp._build_run_result()

        assert result.passed == 2
        assert result.failed == 1
        assert result.pass_rate == pytest.approx(2 / 3 * 100)
        assert len(result.summary.evaluators) == 1
        assert result.summary.evaluators[0].name == "faithfulness"
        assert result.summary.evaluators[0].avg_score == pytest.approx(
            (0.9 + 0.5 + 0.8) / 3
        )

    def test_multiple_evaluators_each_get_their_own_stats(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness": [0.9, 0.5],
                "faithfulness_passed": [True, False],
                "relevance": [0.7, 0.8],
                "relevance_passed": [True, True],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        result = exp._build_run_result()

        names = {e.name for e in result.summary.evaluators}
        assert names == {"faithfulness", "relevance"}
        assert result.passed == 3  # 1 + 2
        assert result.failed == 1

    def test_target_column_produces_per_target_stats(self):
        df = pd.DataFrame(
            {
                "target": ["gpt-4o", "gpt-4o", "claude", "claude"],
                "index": [0, 1, 0, 1],
                "faithfulness_passed": [True, True, False, True],
                "duration_ms": [100, 200, 150, 250],
                "cost": [0.001, 0.002, 0.003, 0.004],
            }
        ).set_index(["target", "index"])
        exp = _experiment_with_df(df)

        result = exp._build_run_result()

        assert len(result.summary.targets) == 2
        gpt = next(t for t in result.summary.targets if t.name == "gpt-4o")
        claude = next(t for t in result.summary.targets if t.name == "claude")
        assert gpt.passed == 2 and gpt.failed == 0
        assert claude.passed == 1 and claude.failed == 1
        assert gpt.avg_latency == pytest.approx(150.0)
        assert claude.total_cost == pytest.approx(0.007)

    def test_counts_rows_with_errors_as_failed_cells(self):
        df = pd.DataFrame(
            {
                "index": [0, 1, 2],
                "faithfulness_passed": [True, True, True],
                "error": [None, "timeout after 30s", None],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        result = exp._build_run_result()

        assert result.summary.failed_cells == 1
        assert result.summary.completed_cells == 2
        assert result.summary.total_cells == 3

    def test_ignores_non_passed_columns(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "question": ["a?", "b?"],  # a string column, not an evaluator
                "faithfulness_passed": [True, True],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        result = exp._build_run_result()

        assert result.passed == 2
        assert len(result.summary.evaluators) == 1


class TestPrintSummary:
    """when calling experiment.print_summary"""

    def test_prints_experiment_name_and_counts(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness_passed": [True, True],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        buf = io.StringIO()
        with redirect_stdout(buf):
            exp.print_summary(exit_on_failure=False)

        output = buf.getvalue()
        assert "run_abc" in output
        assert "Passed:     2" in output
        assert "Failed:     0" in output
        assert "100.0%" in output

    def test_exits_with_code_1_on_failure_when_exit_on_failure_true(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness_passed": [True, False],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        buf = io.StringIO()
        with redirect_stdout(buf), pytest.raises(SystemExit) as exc:
            exp.print_summary(exit_on_failure=True)

        assert exc.value.code == 1

    def test_does_not_exit_when_exit_on_failure_false(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness_passed": [True, False],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        buf = io.StringIO()
        with redirect_stdout(buf):
            # Should not raise SystemExit
            exp.print_summary(exit_on_failure=False)
        assert "Failed:     1" in buf.getvalue()

    def test_does_not_exit_on_success_even_with_exit_on_failure_true(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness_passed": [True, True],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        buf = io.StringIO()
        with redirect_stdout(buf):
            exp.print_summary(exit_on_failure=True)
        # No SystemExit raised
        assert "100.0%" in buf.getvalue()

    def test_default_exits_in_non_notebook_context(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness_passed": [True, False],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        with patch("langwatch.experiment.experiment._is_notebook", return_value=False):
            buf = io.StringIO()
            with redirect_stdout(buf), pytest.raises(SystemExit) as exc:
                exp.print_summary()
            assert exc.value.code == 1

    def test_default_does_not_exit_in_notebook_context(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness_passed": [True, False],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        with patch("langwatch.experiment.experiment._is_notebook", return_value=True):
            buf = io.StringIO()
            with redirect_stdout(buf):
                exp.print_summary()
            # No SystemExit — test passes if we reach here
            assert "Failed:     1" in buf.getvalue()

    def test_exits_on_execution_errors_even_when_all_evaluators_passed(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness_passed": [True, True],
                "error": [None, "LLM call timed out"],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        buf = io.StringIO()
        with redirect_stdout(buf), pytest.raises(SystemExit) as exc:
            exp.print_summary(exit_on_failure=True)

        assert exc.value.code == 1

    def test_status_reflects_failures_not_completed(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness_passed": [True, False],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        result = exp._build_run_result()

        assert result.status == "failed"

    def test_status_is_completed_when_all_pass(self):
        df = pd.DataFrame(
            {
                "index": [0, 1],
                "faithfulness_passed": [True, True],
            }
        ).set_index("index")
        exp = _experiment_with_df(df)

        result = exp._build_run_result()

        assert result.status == "completed"

    def test_handles_empty_results_gracefully(self):
        exp = _experiment_with_df(pd.DataFrame())

        buf = io.StringIO()
        with redirect_stdout(buf):
            exp.print_summary(exit_on_failure=False)

        # No crash, no exit — zero counts printed
        assert "Passed:     0" in buf.getvalue()
        assert "Failed:     0" in buf.getvalue()
