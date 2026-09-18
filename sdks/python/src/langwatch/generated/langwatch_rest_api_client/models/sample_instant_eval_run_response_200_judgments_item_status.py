from enum import Enum


class SampleInstantEvalRunResponse200JudgmentsItemStatus(str, Enum):
    FAILED = "failed"
    JUDGED = "judged"
    SKIPPED = "skipped"

    def __str__(self) -> str:
        return str(self.value)
