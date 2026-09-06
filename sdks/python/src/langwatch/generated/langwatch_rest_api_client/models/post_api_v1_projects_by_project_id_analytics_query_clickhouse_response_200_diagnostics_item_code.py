from enum import Enum


class PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemCode(str, Enum):
    INCOMPLETE_COMPARISON_PERIOD = "INCOMPLETE_COMPARISON_PERIOD"
    MISSING_TIME_BUCKETS = "MISSING_TIME_BUCKETS"
    POSSIBLE_FANOUT = "POSSIBLE_FANOUT"
    RESULT_TRUNCATED = "RESULT_TRUNCATED"
    UNBOUNDED_TIME_RANGE = "UNBOUNDED_TIME_RANGE"

    def __str__(self) -> str:
        return str(self.value)
