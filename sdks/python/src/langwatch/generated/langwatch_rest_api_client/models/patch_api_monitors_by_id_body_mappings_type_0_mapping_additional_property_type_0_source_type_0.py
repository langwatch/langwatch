from enum import Enum


class PatchApiMonitorsByIdBodyMappingsType0MappingAdditionalPropertyType0SourceType0(str, Enum):
    ANNOTATIONS = "annotations"
    CONTEXTS = "contexts"
    CONTEXTS_STRING_LIST = "contexts.string_list"
    EVALUATIONS = "evaluations"
    EVENTS = "events"
    FORMATTED_TRACE = "formatted_trace"
    INPUT = "input"
    METADATA = "metadata"
    METRICS_COMPLETION_TOKENS = "metrics.completion_tokens"
    METRICS_FIRST_TOKEN_MS = "metrics.first_token_ms"
    METRICS_PROMPT_TOKENS = "metrics.prompt_tokens"
    METRICS_TOTAL_COST = "metrics.total_cost"
    METRICS_TOTAL_TIME_MS = "metrics.total_time_ms"
    METRICS_TOTAL_TOKENS = "metrics.total_tokens"
    OUTPUT = "output"
    SPANS = "spans"
    SPANS_LLM_INPUT = "spans.llm.input"
    SPANS_LLM_OUTPUT = "spans.llm.output"
    THREADS = "threads"
    THREADS_UNTIL_CURRENT = "threads_until_current"
    THREAD_ID = "thread_id"
    TIMESTAMP = "timestamp"
    TRACE_ID = "trace_id"

    def __str__(self) -> str:
        return str(self.value)
