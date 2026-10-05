from enum import Enum


class GetApiV1QueryReferenceResponse200ExamplesItemLanguage(str, Enum):
    LWQL = "lwql"
    TRACE_FILTER = "trace-filter"

    def __str__(self) -> str:
        return str(self.value)
