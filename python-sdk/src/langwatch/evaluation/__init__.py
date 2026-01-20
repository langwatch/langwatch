"""
langwatch.evaluation - DEPRECATED, use langwatch.experiment instead.

This module is kept for backward compatibility. All functionality has moved
to langwatch.experiment.
"""
import warnings
from typing import Optional

# Re-export everything from experiment module with deprecation
from langwatch.experiment.experiment import Experiment as _Experiment
from langwatch.experiment.platform_run import (
    run as _run,
    ExperimentRunResult,
    ExperimentRunSummary,
    ExperimentNotFoundError,
    ExperimentTimeoutError,
    ExperimentRunFailedError,
    ExperimentsApiError,
    TargetStats,
    EvaluatorStats,
)

# Deprecated aliases for old names
EvaluationRunResult = ExperimentRunResult
EvaluationRunSummary = ExperimentRunSummary
EvaluationNotFoundError = ExperimentNotFoundError
EvaluationTimeoutError = ExperimentTimeoutError
EvaluationRunFailedError = ExperimentRunFailedError
EvaluationsApiError = ExperimentsApiError

# Keep Evaluation as alias to Experiment for backward compatibility
Evaluation = _Experiment


def run(*args, **kwargs) -> ExperimentRunResult:
    """
    Deprecated: Use langwatch.experiment.run() instead.
    """
    warnings.warn(
        "langwatch.evaluation.run() is deprecated, use langwatch.experiment.run() instead",
        DeprecationWarning,
        stacklevel=2,
    )
    return _run(*args, **kwargs)


def init(name: str, *, run_id: Optional[str] = None) -> _Experiment:
    """
    Deprecated: Use langwatch.experiment.init() instead.
    """
    warnings.warn(
        "langwatch.evaluation.init() is deprecated, use langwatch.experiment.init() instead",
        DeprecationWarning,
        stacklevel=2,
    )
    experiment = _Experiment(name, run_id=run_id)
    experiment.init()
    return experiment


__all__ = [
    "init",
    "run",
    "Evaluation",
    # Old names (deprecated)
    "EvaluationRunResult",
    "EvaluationRunSummary",
    "EvaluationNotFoundError",
    "EvaluationTimeoutError",
    "EvaluationRunFailedError",
    "EvaluationsApiError",
    # New names
    "ExperimentRunResult",
    "ExperimentRunSummary",
    "ExperimentNotFoundError",
    "ExperimentTimeoutError",
    "ExperimentRunFailedError",
    "ExperimentsApiError",
    "TargetStats",
    "EvaluatorStats",
]
