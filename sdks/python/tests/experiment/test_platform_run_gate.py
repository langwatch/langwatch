"""The CI gate of a platform run: print_summary keeps its default exit code and fails on
failed evaluations only when asked to.

Spec: sdks/typescript/specs/evaluation/experiment-run-gate.feature
"""

from typing import Optional

import pytest

from langwatch.experiment.platform_run import _build_result

BASE_SUMMARY = {
    "runId": "run_1",
    "totalCells": 3,
    "completedCells": 3,
    "failedCells": 0,
    "duration": 1000,
}
FAILING_VERDICT = [
    {"evaluatorId": "ev_1", "name": "exact_match", "passed": 2, "failed": 1, "passRate": 66.7}
]
PASSING_VERDICT = [
    {"evaluatorId": "ev_1", "name": "exact_match", "passed": 3, "failed": 0, "passRate": 100}
]


def _exit_code(
    summary: dict,
    *,
    exit_on_failure: Optional[bool] = True,
    fail_on_evaluator_failures: bool = False,
) -> int:
    result = _build_result("run_1", "completed", summary, "https://app/run_1")
    with pytest.raises(SystemExit) as exited:
        result.print_summary(
            exit_on_failure=exit_on_failure,
            fail_on_evaluator_failures=fail_on_evaluator_failures,
        )
        raise SystemExit(0)
    return int(exited.value.code or 0)


def test_by_default_an_errored_cell_fails_the_job():
    assert _exit_code({**BASE_SUMMARY, "failedCells": 1}) == 1


def test_by_default_a_failed_evaluation_leaves_the_job_green():
    assert _exit_code({**BASE_SUMMARY, "evaluators": FAILING_VERDICT}) == 0


def test_opting_in_fails_the_job_on_a_failed_evaluation():
    summary = {**BASE_SUMMARY, "evaluators": FAILING_VERDICT}
    assert _exit_code(summary, fail_on_evaluator_failures=True) == 1


def test_opting_in_still_passes_a_run_whose_evaluations_all_passed():
    summary = {**BASE_SUMMARY, "evaluators": PASSING_VERDICT}
    assert _exit_code(summary, fail_on_evaluator_failures=True) == 0


def test_opting_in_against_a_server_without_tallies_keeps_the_cell_gate():
    assert _exit_code(BASE_SUMMARY, fail_on_evaluator_failures=True) == 0


def test_turning_exit_off_wins_over_the_opt_in():
    summary = {**BASE_SUMMARY, "failedCells": 1, "evaluators": FAILING_VERDICT}
    code = _exit_code(summary, exit_on_failure=False, fail_on_evaluator_failures=True)
    assert code == 0
