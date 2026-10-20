from enum import Enum


class PostApiV1QueryResponse200CompletenessState(str, Enum):
    COMPLETE = "complete"
    MISSING = "missing"
    NO_TRAFFIC = "no_traffic"
    PARTIAL = "partial"

    def __str__(self) -> str:
        return str(self.value)
