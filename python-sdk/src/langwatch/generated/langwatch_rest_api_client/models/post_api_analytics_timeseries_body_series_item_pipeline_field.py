from enum import Enum


class PostApiAnalyticsTimeseriesBodySeriesItemPipelineField(str, Enum):
    CUSTOMER_ID = "customer_id"
    THREAD_ID = "thread_id"
    TRACE_ID = "trace_id"
    USER_ID = "user_id"

    def __str__(self) -> str:
        return str(self.value)
