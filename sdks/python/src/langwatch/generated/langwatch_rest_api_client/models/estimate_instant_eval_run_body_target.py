from enum import Enum


class EstimateInstantEvalRunBodyTarget(str, Enum):
    LLM_SPANS = "llm_spans"
    THREADS = "threads"
    TRACES = "traces"

    def __str__(self) -> str:
        return str(self.value)
