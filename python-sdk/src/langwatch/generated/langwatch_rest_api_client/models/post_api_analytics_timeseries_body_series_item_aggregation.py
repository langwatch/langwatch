from enum import Enum


class PostApiAnalyticsTimeseriesBodySeriesItemAggregation(str, Enum):
    AVG = "avg"
    CARDINALITY = "cardinality"
    MAX = "max"
    MEDIAN = "median"
    MIN = "min"
    P90 = "p90"
    P95 = "p95"
    P99 = "p99"
    SUM = "sum"
    TERMS = "terms"

    def __str__(self) -> str:
        return str(self.value)
