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

   experiment = langwatch.experiment.init("my-experiment")

   for index, row in experiment.loop(df.iterrows(), threads=4):
       async def task(index, row):
           result = await my_agent(row["input"])
           experiment.evaluate(
               "langevals/exact_match",
               index=index,
               data={"output": result, "expected_output": row["expected"]},
               settings={},
           )
       experiment.submit(task, index, row)
   ```
"""
from typing import Optional

# Re-export the Experiment class for SDK-defined experiments
from langwatch.experiment.experiment import Experiment

# Re-export the platform run function and related types
from langwatch.experiment.platform_run import (
    run,
    ExperimentRunResult,
    ExperimentRunSummary,
    ExperimentNotFoundError,
    ExperimentTimeoutError,
    ExperimentRunFailedError,
    ExperimentsApiError,
    TargetStats,
    EvaluatorStats,
)


def init(name: str, *, run_id: Optional[str] = None) -> Experiment:
    """
    Initialize an SDK-defined experiment.

    This creates an Experiment instance that you can use to run evaluators
    programmatically using datasets and custom logic.

    Args:
        name: Name for this experiment run
        run_id: Optional custom run ID (auto-generated if not provided)

    Returns:
        Experiment instance with methods:
        - loop(): Iterate over dataset rows with parallel execution
        - evaluate(): Run an evaluator on the current row
        - log(): Log custom metrics
        - submit(): Submit async tasks

    Example:
        ```python
        import langwatch

        experiment = langwatch.experiment.init("my-experiment")

        for index, row in experiment.loop(df.iterrows(), threads=4):
            async def task(index, row):
                result = await my_agent(row["input"])
                experiment.evaluate(
                    "langevals/exact_match",
                    index=index,
                    data={"output": result, "expected_output": row["expected"]},
                    settings={},
                )
            experiment.submit(task, index, row)
        ```
    """
    experiment = Experiment(name, run_id=run_id)
    experiment.init()
    return experiment


__all__ = [
    "init",
    "run",
    "Experiment",
    "ExperimentRunResult",
    "ExperimentRunSummary",
    "ExperimentNotFoundError",
    "ExperimentTimeoutError",
    "ExperimentRunFailedError",
    "ExperimentsApiError",
    "TargetStats",
    "EvaluatorStats",
]
