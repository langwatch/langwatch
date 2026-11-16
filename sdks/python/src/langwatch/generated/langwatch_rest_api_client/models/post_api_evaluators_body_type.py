from enum import Enum


class PostApiEvaluatorsBodyType(str, Enum):
    CODE = "code"
    EVALUATOR = "evaluator"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
