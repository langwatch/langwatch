from enum import Enum


class CancelInstantEvalRunResponse200QuestionsItemKind(str, Enum):
    BOOLEAN = "boolean"
    CATEGORY = "category"
    SCORE = "score"

    def __str__(self) -> str:
        return str(self.value)
