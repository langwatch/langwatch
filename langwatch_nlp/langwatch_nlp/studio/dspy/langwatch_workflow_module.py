import dspy

from langwatch_nlp.studio.dspy.reporting_module import ReportingModule

from langwatch_nlp.studio.field_parser import with_autoparsing
from langwatch_nlp.studio.dspy.patched_optional_image import patch_optional_image


patch_optional_image()


class LangWatchWorkflowModule(ReportingModule):
    cost: float = 0
    start_time: float = 0

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def wrapped(self, module: dspy.Module, node_id: str):
        async def wrapper(*args, **kwargs):
            module_ = dspy.asyncify(
                self.with_reporting(with_autoparsing(module), node_id)  # type: ignore
            )
            result = await module_(*args, **kwargs)
            self.cost += getattr(result, "cost", None) or 0
            return result

        return wrapper
