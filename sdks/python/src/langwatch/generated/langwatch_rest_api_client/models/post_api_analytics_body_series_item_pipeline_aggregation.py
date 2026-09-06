from enum import Enum


class PostApiAnalyticsBodySeriesItemPipelineAggregation(str, Enum):
    AVG = "avg"
    MAX = "max"
    MIN = "min"
    SUM = "sum"

    def __str__(self) -> str:
        return str(self.value)
