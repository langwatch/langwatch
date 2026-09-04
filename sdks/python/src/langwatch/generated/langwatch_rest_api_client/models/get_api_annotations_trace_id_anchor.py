from enum import Enum


class GetApiAnnotationsTraceIdAnchor(str, Enum):
    ALL = "all"
    TRACE = "trace"

    def __str__(self) -> str:
        return str(self.value)
