from typing import Optional
from langwatch.evaluation.evaluation import Evaluation
from langwatch.evaluation.platform_run import (
    evaluate,
    run,  # Deprecated, kept for backwards compatibility
    EvaluationRunResult,
    EvaluationRunSummary,
    EvaluationNotFoundError,
    EvaluationTimeoutError,
    EvaluationRunFailedError,
    EvaluationsApiError,
    TargetStats,
    EvaluatorStats,
)


def init(name: str, *, run_id: Optional[str] = None) -> Evaluation:
    evaluation = Evaluation(name, run_id=run_id)
    evaluation.init()
    return evaluation


__all__ = [
    "init",
    "evaluate",
    "run",  # Deprecated
    "Evaluation",
    "EvaluationRunResult",
    "EvaluationRunSummary",
    "EvaluationNotFoundError",
    "EvaluationTimeoutError",
    "EvaluationRunFailedError",
    "EvaluationsApiError",
    "TargetStats",
    "EvaluatorStats",
]
