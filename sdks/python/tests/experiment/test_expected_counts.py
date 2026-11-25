"""
The finishing batch tells the platform how many rows and verdicts the run
reported, so a reader can tell a run that is still being stored from a whole one.
"""

from typing import Any
from unittest.mock import patch

from langwatch.experiment.experiment import (
    BatchEntry,
    EvaluationResult,
    Experiment,
)


def _row(index: int, target: str) -> BatchEntry:
    return BatchEntry(
        index=index, entry={"q": index}, duration=1, trace_id="t", target_id=target
    )


def _verdict(index: int, target: str, evaluator: str) -> EvaluationResult:
    return EvaluationResult(
        name=evaluator,
        evaluator=evaluator,
        trace_id="t",
        status="processed",
        passed=True,
        data={},
        index=index,
        target_id=target,
    )


def _send(experiment: Experiment, *, finished: bool) -> dict[str, Any]:
    sent: list[dict[str, Any]] = []
    with patch.object(
        Experiment,
        "_log_results_in_parts",
        side_effect=lambda _api_key, body: sent.append(body),
    ):
        experiment._send_batch(finished=finished)
        for thread in experiment.threads:
            thread.join()
    return sent[-1]


class TestExpectedCounts:
    # @scenario "The finishing batch carries the counts the run reported"
    def test_finishing_batch_carries_the_counts_of_every_batch_sent(self):
        experiment = Experiment("expected-counts")
        experiment.batch["dataset"].extend([_row(0, "a"), _row(0, "b")])
        experiment.batch["evaluations"].extend(
            [_verdict(0, "a", "exact"), _verdict(0, "b", "exact")]
        )
        first = _send(experiment, finished=False)

        experiment.batch["dataset"].append(_row(1, "a"))
        experiment.batch["evaluations"].extend(
            [_verdict(1, "a", "exact"), _verdict(1, "a", "tone")]
        )
        last = _send(experiment, finished=True)

        assert "expected" not in first
        assert last["expected"] == {"dataset": 3, "evaluations": 4}
        assert last["timestamps"]["finished_at"] > 0

    # @scenario "A verdict logged twice for one cell counts once"
    def test_a_verdict_logged_twice_for_one_cell_counts_once(self):
        experiment = Experiment("expected-counts")
        experiment.batch["evaluations"].append(_verdict(0, "a", "exact"))
        _send(experiment, finished=False)
        experiment.batch["evaluations"].append(_verdict(0, "a", "exact"))

        last = _send(experiment, finished=True)

        assert last["expected"] == {"dataset": 0, "evaluations": 1}
