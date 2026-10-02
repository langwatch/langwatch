from enum import Enum


class PostApiV1QueryResponse200DiagnosticsItemCode(str, Enum):
    INCOMPLETE_COMPARISON_PERIOD = "INCOMPLETE_COMPARISON_PERIOD"
    MISSING_TIME_BUCKETS = "MISSING_TIME_BUCKETS"
    MULTI_PROJECT_RESULT = "MULTI_PROJECT_RESULT"
    POSSIBLE_FANOUT = "POSSIBLE_FANOUT"
    UNBOUNDED_TIME_RANGE = "UNBOUNDED_TIME_RANGE"

    def __str__(self) -> str:
        return str(self.value)
