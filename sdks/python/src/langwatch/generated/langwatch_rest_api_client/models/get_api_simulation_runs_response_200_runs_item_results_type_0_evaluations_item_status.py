from enum import Enum


class GetApiSimulationRunsResponse200RunsItemResultsType0EvaluationsItemStatus(str, Enum):
    ERROR = "error"
    FAILED = "failed"
    PASSED = "passed"
    SCORED = "scored"
    SKIPPED = "skipped"

    def __str__(self) -> str:
        return str(self.value)
