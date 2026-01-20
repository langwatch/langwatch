"""
langwatch.experiment - Run experiments on LangWatch platform or via SDK.

This module provides two ways to run experiments:

1. Platform experiments (CI/CD):
   Run experiments configured in the LangWatch platform UI.

   ```python
   import langwatch

   result = langwatch.experiment.run("my-experiment-slug")
   result.print_summary()
   ```

2. SDK-defined experiments:
   Define and run experiments programmatically.

   ```python
   import langwatch

   evaluation = langwatch.experiment.init("my-experiment")

   for index, row in evaluation.loop(df.iterrows(), threads=4):
       async def task(index, row):
           result = await my_agent(row["input"])
           evaluation.evaluate(
               "langevals/exact_match",
               index=index,
               data={"output": result, "expected_output": row["expected"]},
               settings={},
           )
       evaluation.submit(task, index, row)
   ```
"""
from typing import Optional

# Re-export the Evaluation class for SDK-defined experiments
from langwatch.evaluation.evaluation import Evaluation

# Re-export the platform run function and related types
from langwatch.evaluation.platform_run import (
    run,
    EvaluationRunResult as ExperimentRunResult,
    EvaluationRunSummary as ExperimentRunSummary,
    EvaluationNotFoundError as ExperimentNotFoundError,
    EvaluationTimeoutError as ExperimentTimeoutError,
    EvaluationRunFailedError as ExperimentRunFailedError,
    EvaluationsApiError as ExperimentsApiError,
    TargetStats,
    EvaluatorStats,
)


def init(name: str, *, run_id: Optional[str] = None) -> Evaluation:
    """
    Initialize an SDK-defined experiment.

    This creates an Evaluation instance that you can use to run evaluators
    programmatically using datasets and custom logic.

    Args:
        name: Name for this experiment run
        run_id: Optional custom run ID (auto-generated if not provided)

    Returns:
        Evaluation instance with methods:
        - loop(): Iterate over dataset rows with parallel execution
        - evaluate(): Run an evaluator on the current row
        - log(): Log custom metrics
        - submit(): Submit async tasks

    Example:
        ```python
        import langwatch

        evaluation = langwatch.experiment.init("my-experiment")

        for index, row in evaluation.loop(df.iterrows(), threads=4):
            async def task(index, row):
                result = await my_agent(row["input"])
                evaluation.evaluate(
                    "langevals/exact_match",
                    index=index,
                    data={"output": result, "expected_output": row["expected"]},
                    settings={},
                )
            evaluation.submit(task, index, row)
        ```
    """
    evaluation = Evaluation(name, run_id=run_id)
    evaluation.init()
    return evaluation


__all__ = [
    "init",
    "run",
    "Evaluation",
    "ExperimentRunResult",
    "ExperimentRunSummary",
    "ExperimentNotFoundError",
    "ExperimentTimeoutError",
    "ExperimentRunFailedError",
    "ExperimentsApiError",
    "TargetStats",
    "EvaluatorStats",
]
