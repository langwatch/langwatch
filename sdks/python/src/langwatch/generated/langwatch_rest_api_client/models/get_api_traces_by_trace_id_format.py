from enum import Enum


class GetApiTracesByTraceIdFormat(str, Enum):
    DIGEST = "digest"
    JSON = "json"

    def __str__(self) -> str:
        return str(self.value)
