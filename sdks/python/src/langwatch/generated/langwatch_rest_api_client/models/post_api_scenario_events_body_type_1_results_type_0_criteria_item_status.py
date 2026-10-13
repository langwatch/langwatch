from enum import Enum


class PostApiScenarioEventsBodyType1ResultsType0CriteriaItemStatus(str, Enum):
    FAILED = "failed"
    INCONCLUSIVE = "inconclusive"
    PASSED = "passed"

    def __str__(self) -> str:
        return str(self.value)
