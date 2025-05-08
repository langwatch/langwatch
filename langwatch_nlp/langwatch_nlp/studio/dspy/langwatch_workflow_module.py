import time
from typing import Any, Dict, Tuple, TypeVar
import dspy
from concurrent.futures import ThreadPoolExecutor, as_completed

from langwatch_nlp.studio.dspy.evaluation import (
    EvaluationResultWithMetadata,
    PredictionWithEvaluationAndMetadata,
)
from langwatch_nlp.studio.dspy.reporting_module import ReportingModule

from langwatch_nlp.studio.field_parser import with_autoparsing
from langwatch_nlp.studio.dspy.patched_optional_image import patch_optional_image


patch_optional_image()

T = TypeVar("T", bound=dspy.Module)


class LangWatchWorkflowModule(ReportingModule):
    cost: float = 0
    duration: int = 0

    def __init__(self, run_evaluations: bool = False, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def forward(self, *args, **kwargs):
        raise NotImplementedError("This method should be implemented by the subclass")

    def wrapped(self, module: T, node_id: str, run: bool = True) -> T:
        # If already patched, unpatch everything
        if hasattr(module, "__forward_before_autoparsing__"):
            module.forward = module.__forward_before_autoparsing__  # type: ignore
            delattr(module, "__forward_before_autoparsing__")
            delattr(module, "__forward_before_reporting__")
            delattr(module, "__forward_before_metadata__")

        module = self.with_reporting(with_autoparsing(module), node_id)
        module.__forward_before_metadata__ = module.forward  # type: ignore

        def forward_with_metadata(instance_self, *args, **kwargs):
            if not run:
                return EvaluationResultWithMetadata(
                    status="skipped",
                    details=f"Node {node_id} skipped",
                    inputs=kwargs,
                    duration=0,
                )

            start_time = time.time()
            try:
                result = module.__forward_before_metadata__(instance_self, *args, **kwargs)  # type: ignore
                # Skip cost and duration calculation for evaluation results as those are counted separately
                if not isinstance(result, PredictionWithEvaluationAndMetadata):
                    cost = getattr(result, "cost", None)
                    self.cost += cost.amount if cost else 0
                    self.duration += round(time.time() - start_time)
                if isinstance(result, dict):
                    result = dspy.Prediction(**result)
            except Exception as e:
                self.duration += round(time.time() - start_time)
                raise e
            return result

        module.forward = forward_with_metadata  # type: ignore
        return module

    def run_in_parallel(self, *module_kwargs: Tuple[T, Dict[str, Any]]):
        """
        Execute multiple modules in parallel using threads.

        Args:
            module_kwargs: A list of tuples where each tuple contains (module, kwargs)
                         to be executed as module(**kwargs)

        Returns:
            A list of results from each module in the same order as the input modules
        """
        results = [None] * len(module_kwargs)

        def execute_module(idx, module, kwargs):
            result = module(**kwargs)
            return idx, result

        # Use ThreadPoolExecutor to run the modules in parallel
        with ThreadPoolExecutor() as executor:
            # Submit all tasks to the executor
            futures = {
                executor.submit(execute_module, idx, module, kwargs): idx
                for idx, (module, kwargs) in enumerate(module_kwargs)
            }

            # Process results as they complete
            for future in as_completed(futures):
                idx, result = future.result()
                results[idx] = result

        return results

    def prevent_crashes(self):
        if hasattr(self, "__forward_before_prevent_crashes__"):
            self.forward = self.__forward_before_prevent_crashes__
            delattr(self, "__forward_before_prevent_crashes__")

        self.__forward_before_prevent_crashes__ = self.forward

        def prevent_crashes_forward(*args, **kwargs):
            try:
                return self.__forward_before_prevent_crashes__(*args, **kwargs)
            except Exception as e:
                return PredictionWithEvaluationAndMetadata(
                    duration=self.duration,
                    cost=self.cost,
                    error=e,
                )

        self.forward = prevent_crashes_forward
