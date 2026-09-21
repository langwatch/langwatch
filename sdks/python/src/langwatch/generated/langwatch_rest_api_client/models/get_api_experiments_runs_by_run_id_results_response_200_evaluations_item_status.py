from enum import Enum


class GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemStatus(str, Enum):
    ERROR = "error"
    PROCESSED = "processed"
    SKIPPED = "skipped"

    def __str__(self) -> str:
        return str(self.value)
