import functools
import time
import types
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

    def wrapped(self, module: type[T], node_id: str, run: bool = True) -> type[T]:
        # Create a subclass to avoid polluting the original class with patches
        # This prevents the `run` value from leaking across different workflow executions
        class WrappedModule(module):  # type: ignore
            pass

        # Apply autoparsing and reporting to the subclass, not the original
        wrapped_module = self.with_reporting(with_autoparsing(WrappedModule), node_id)

        # Resolve entrypoint: forward (dspy.Module convention) or __call__ (plain class).
        # Check via __dict__ on the MRO to avoid picking up type.__call__ (metaclass)
        # which exists on every class and would give a false positive.
        def _has_own_method(cls, name):
            return any(name in klass.__dict__ for klass in cls.__mro__ if klass not in (type, object))

        original_method = getattr(wrapped_module, "forward", None) if _has_own_method(wrapped_module, "forward") else None
        entrypoint_attr = "forward"
        if not callable(original_method):
            original_method = getattr(wrapped_module, "__call__", None) if _has_own_method(wrapped_module, "__call__") else None
            entrypoint_attr = "__call__"
        if not callable(original_method):
            raise TypeError(
                f"Class '{module.__name__}' for node {node_id} has no callable "
                f"entrypoint. Define forward(self, ...) or __call__(self, ...)."
            )

        wrapped_module.__forward_before_metadata__ = original_method  # type: ignore

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
                result = wrapped_module.__forward_before_metadata__(instance_self, *args, **kwargs)  # type: ignore
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

        setattr(wrapped_module, entrypoint_attr, forward_with_metadata)
        return wrapped_module

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
        # If already patched, repatch so new config can be picked up
        if hasattr(self, "__forward_before_prevent_crashes__"):
            self.forward = self.__forward_before_prevent_crashes__  # type: ignore
        self.__forward_before_prevent_crashes__ = self.forward  # type: ignore

        @functools.wraps(self.__forward_before_prevent_crashes__)
        def prevent_crashes_forward(self, *args, **kwargs):
            try:
                return self.__forward_before_prevent_crashes__(*args, **kwargs)  # type: ignore
            except Exception as e:
                return PredictionWithEvaluationAndMetadata(
                    duration=self.duration,
                    cost=self.cost,
                    error=e,
                )

        self.forward = types.MethodType(prevent_crashes_forward, self)  # type: ignore
        return self
