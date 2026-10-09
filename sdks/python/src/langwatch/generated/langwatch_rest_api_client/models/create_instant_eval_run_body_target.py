from enum import Enum


class CreateInstantEvalRunBodyTarget(str, Enum):
    LLM_SPANS = "llm_spans"
    THREADS = "threads"
    TRACES = "traces"

    def __str__(self) -> str:
        return str(self.value)
