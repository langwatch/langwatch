from enum import Enum


class PostApiTracesSearchBodyFrom(str, Enum):
    TRACES = "traces"

    def __str__(self) -> str:
        return str(self.value)
