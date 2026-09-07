from enum import Enum


class GetApiTracesByTraceIdLlmMode(str, Enum):
    FALSE = "false"
    TRUE = "true"
    VALUE_2 = "1"
    VALUE_3 = "0"

    def __str__(self) -> str:
        return str(self.value)
