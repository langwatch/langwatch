from enum import Enum


class EstimateInstantEvalRunBodyQuestionsItemKind(str, Enum):
    BOOLEAN = "boolean"
    CATEGORY = "category"
    SCORE = "score"

    def __str__(self) -> str:
        return str(self.value)
