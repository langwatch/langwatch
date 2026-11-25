from enum import Enum


class GetApiSimulationRunsResponse200RunsItemResultsType0CriteriaItemStatus(str, Enum):
    FAILED = "failed"
    INCONCLUSIVE = "inconclusive"
    PASSED = "passed"

    def __str__(self) -> str:
        return str(self.value)
