import time
import dspy

from langwatch_nlp.studio.dspy.evaluation import PredictionWithEvaluationAndMetadata
from langwatch_nlp.studio.dspy.reporting_module import ReportingModule

from langwatch_nlp.studio.field_parser import with_autoparsing
from langwatch_nlp.studio.dspy.patched_optional_image import patch_optional_image


patch_optional_image()


class LangWatchWorkflowModule(ReportingModule):
    cost: float = 0
    duration: int = 0

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def wrapped(self, module: dspy.Module, node_id: str, run: bool = True):
        async def wrapper(*args, **kwargs):
            if not run:
                return PredictionWithEvaluationAndMetadata(
                    status="skipped",
                    description=f"Node {node_id} skipped",
                    cost=0,
                    duration=0,
                )

            start_time = time.time()
            module_ = dspy.asyncify(
                self.with_reporting(with_autoparsing(module), node_id)  # type: ignore
            )
            result = await module_(*args, **kwargs)
            # Skip cost and duration calculation for evaluation results as those are counted separately
            if not isinstance(result, PredictionWithEvaluationAndMetadata):
                self.cost += getattr(result, "cost", None) or 0
                self.duration += round(time.time() - start_time)
            return result

        return wrapper
