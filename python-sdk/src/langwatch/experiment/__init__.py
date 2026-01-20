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

<<<<<<< HEAD
   experiment = langwatch.experiment.init("my-experiment")

   for index, row in experiment.loop(df.iterrows(), threads=4):
       async def task(index, row):
           result = await my_agent(row["input"])
           experiment.evaluate(
=======
   evaluation = langwatch.experiment.init("my-experiment")

   for index, row in evaluation.loop(df.iterrows(), threads=4):
       async def task(index, row):
           result = await my_agent(row["input"])
           evaluation.evaluate(
>>>>>>> 131e50b78 (wip)
               "langevals/exact_match",
               index=index,
               data={"output": result, "expected_output": row["expected"]},
               settings={},
           )
<<<<<<< HEAD
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
=======
       evaluation.submit(task, index, row)
   ```
"""

from typing import Optional

# Re-export the Evaluation class (the instance is still called "evaluation" in examples)
from langwatch.evaluation.evaluation import Evaluation

# Re-export platform run functionality
from langwatch.evaluation.platform_run import (
    run,
    EvaluationRunResult as ExperimentRunResult,
    EvaluationRunSummary as ExperimentRunSummary,
    EvaluationNotFoundError as ExperimentNotFoundError,
    EvaluationTimeoutError as ExperimentTimeoutError,
    EvaluationRunFailedError as ExperimentRunFailedError,
    EvaluationsApiError as ExperimentsApiError,
>>>>>>> 131e50b78 (wip)
    TargetStats,
    EvaluatorStats,
)

<<<<<<< HEAD

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
=======
# Also export with original names for backwards compatibility
from langwatch.evaluation.platform_run import (
    EvaluationRunResult,
    EvaluationRunSummary,
    EvaluationNotFoundError,
    EvaluationTimeoutError,
    EvaluationRunFailedError,
    EvaluationsApiError,
)


def init(name: str, *, run_id: Optional[str] = None) -> Evaluation:
    """
    Initialize a new SDK-defined experiment.

    Args:
        name: Name for the experiment (shown in LangWatch UI)
        run_id: Optional custom run ID (auto-generated if not provided)

    Returns:
        An Evaluation instance to use for running the experiment.
>>>>>>> 131e50b78 (wip)

    Example:
        ```python
        import langwatch

<<<<<<< HEAD
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
=======
        evaluation = langwatch.experiment.init("my-experiment")

        for index, row in evaluation.loop(df.iterrows()):
            async def task(index, row):
                result = await my_agent(row["input"])
                evaluation.log("result", index=index, data={"output": result}, score=0.9)
            evaluation.submit(task, index, row)
        ```
    """
    evaluation = Evaluation(name, run_id=run_id)
    evaluation.init()
    return evaluation


__all__ = [
    # Core functionality
    "init",
    "run",
    "Evaluation",
    # New names (preferred)
>>>>>>> 131e50b78 (wip)
    "ExperimentRunResult",
    "ExperimentRunSummary",
    "ExperimentNotFoundError",
    "ExperimentTimeoutError",
    "ExperimentRunFailedError",
    "ExperimentsApiError",
<<<<<<< HEAD
    "TargetStats",
    "EvaluatorStats",
=======
    # Stats
    "TargetStats",
    "EvaluatorStats",
    # Legacy names (backwards compatibility)
    "EvaluationRunResult",
    "EvaluationRunSummary",
    "EvaluationNotFoundError",
    "EvaluationTimeoutError",
    "EvaluationRunFailedError",
    "EvaluationsApiError",
>>>>>>> 131e50b78 (wip)
]
