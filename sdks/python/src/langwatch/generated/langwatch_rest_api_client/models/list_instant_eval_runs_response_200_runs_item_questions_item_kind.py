from enum import Enum


class ListInstantEvalRunsResponse200RunsItemQuestionsItemKind(str, Enum):
    BOOLEAN = "boolean"
    CATEGORY = "category"
    SCORE = "score"

    def __str__(self) -> str:
        return str(self.value)
