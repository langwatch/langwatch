import asyncio
import time
from typing import TypeVar, cast
import dspy

from langwatch_nlp.studio.dspy.evaluation import (
    EvaluationResultWithMetadata,
    PredictionWithEvaluationAndMetadata,
)
from langwatch_nlp.studio.dspy.reporting_module import ReportingModule

from langwatch_nlp.studio.field_parser import with_autoparsing
from langwatch_nlp.studio.dspy.patched_optional_image import patch_optional_image
from dspy.utils.callback import with_callbacks


patch_optional_image()

T = TypeVar("T", bound=dspy.Module)


class LangWatchWorkflowModule(ReportingModule):
    cost: float = 0
    duration: int = 0

    def __init__(self, run_evaluations: bool = False, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def wrapped(self, module: T, node_id: str, run: bool = True) -> T:
        module_ = dspy.asyncify(
            self.with_reporting(with_autoparsing(module), node_id)  # type: ignore
        )

        async def wrapper(*args, **kwargs):
            if not run:
                return EvaluationResultWithMetadata(
                    status="skipped",
                    details=f"Node {node_id} skipped",
                    inputs=kwargs,
                    duration=0,
                )

            start_time = time.time()
            try:
                result = await module_(*args, **kwargs)
                # Skip cost and duration calculation for evaluation results as those are counted separately
                if not isinstance(result, PredictionWithEvaluationAndMetadata):
                    self.cost += getattr(result, "cost", None) or 0
                    self.duration += round(time.time() - start_time)
            except Exception as e:
                self.duration += round(time.time() - start_time)
                raise e
            return result

        return cast(T, wrapper)
