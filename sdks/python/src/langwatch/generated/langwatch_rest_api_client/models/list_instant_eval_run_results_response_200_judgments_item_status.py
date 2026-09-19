from enum import Enum


class ListInstantEvalRunResultsResponse200JudgmentsItemStatus(str, Enum):
    FAILED = "failed"
    JUDGED = "judged"
    SKIPPED = "skipped"

    def __str__(self) -> str:
        return str(self.value)
