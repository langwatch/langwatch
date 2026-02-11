from enum import Enum


class PostApiAnalyticsTimeseriesBodyGroupBy(str, Enum):
    ERROR_HAS_ERROR = "error.has_error"
    EVALUATIONS_EVALUATION_LABEL = "evaluations.evaluation_label"
    EVALUATIONS_EVALUATION_PASSED = "evaluations.evaluation_passed"
    EVALUATIONS_EVALUATION_PROCESSING_STATE = "evaluations.evaluation_processing_state"
    EVENTS_EVENT_TYPE = "events.event_type"
    METADATA_CUSTOMER_ID = "metadata.customer_id"
    METADATA_LABELS = "metadata.labels"
    METADATA_MODEL = "metadata.model"
    METADATA_SPAN_TYPE = "metadata.span_type"
    METADATA_THREAD_ID = "metadata.thread_id"
    METADATA_USER_ID = "metadata.user_id"
    SENTIMENT_INPUT_SENTIMENT = "sentiment.input_sentiment"
    SENTIMENT_THUMBS_UP_DOWN = "sentiment.thumbs_up_down"
    TOPICS_TOPICS = "topics.topics"

    def __str__(self) -> str:
        return str(self.value)
