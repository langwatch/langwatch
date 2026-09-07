from enum import Enum


class PostApiMonitorsBodyLevel(str, Enum):
    THREAD = "thread"
    TRACE = "trace"

    def __str__(self) -> str:
        return str(self.value)
