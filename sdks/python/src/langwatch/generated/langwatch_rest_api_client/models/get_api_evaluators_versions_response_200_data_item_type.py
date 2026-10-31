from enum import Enum


class GetApiEvaluatorsVersionsResponse200DataItemType(str, Enum):
    CODE = "code"
    EVALUATOR = "evaluator"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
