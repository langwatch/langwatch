from enum import Enum


class PostApiAnalyticsTimeseriesBodySeriesItemMetric(str, Enum):
    EVALUATIONS_EVALUATION_PASS_RATE = "evaluations.evaluation_pass_rate"
    EVALUATIONS_EVALUATION_RUNS = "evaluations.evaluation_runs"
    EVALUATIONS_EVALUATION_SCORE = "evaluations.evaluation_score"
    EVENTS_EVENT_DETAILS = "events.event_details"
    EVENTS_EVENT_SCORE = "events.event_score"
    EVENTS_EVENT_TYPE = "events.event_type"
    METADATA_SPAN_TYPE = "metadata.span_type"
    METADATA_THREAD_ID = "metadata.thread_id"
    METADATA_TRACE_ID = "metadata.trace_id"
    METADATA_USER_ID = "metadata.user_id"
    PERFORMANCE_CACHE_READ_TOKENS = "performance.cache_read_tokens"
    PERFORMANCE_CACHE_WRITE_TOKENS = "performance.cache_write_tokens"
    PERFORMANCE_COMPLETION_TIME = "performance.completion_time"
    PERFORMANCE_COMPLETION_TOKENS = "performance.completion_tokens"
    PERFORMANCE_COST_BILLED = "performance.cost_billed"
    PERFORMANCE_COST_NON_BILLED = "performance.cost_non_billed"
    PERFORMANCE_FIRST_TOKEN = "performance.first_token"
    PERFORMANCE_PROMPT_TOKENS = "performance.prompt_tokens"
    PERFORMANCE_REASONING_TOKENS = "performance.reasoning_tokens"
    PERFORMANCE_TOKENS_PER_SECOND = "performance.tokens_per_second"
    PERFORMANCE_TOTAL_COST = "performance.total_cost"
    PERFORMANCE_TOTAL_PROCESSED_TOKENS = "performance.total_processed_tokens"
    PERFORMANCE_TOTAL_TOKENS = "performance.total_tokens"
    SENTIMENT_THUMBS_UP_DOWN = "sentiment.thumbs_up_down"
    THREADS_AVERAGE_DURATION_PER_THREAD = "threads.average_duration_per_thread"

    def __str__(self) -> str:
        return str(self.value)
