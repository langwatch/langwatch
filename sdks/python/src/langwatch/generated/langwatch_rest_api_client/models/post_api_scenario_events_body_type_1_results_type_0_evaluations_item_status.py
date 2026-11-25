from enum import Enum


class PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemStatus(str, Enum):
    ERROR = "error"
    FAILED = "failed"
    PASSED = "passed"
    SCORED = "scored"
    SKIPPED = "skipped"

    def __str__(self) -> str:
        return str(self.value)
