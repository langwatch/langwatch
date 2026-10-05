from enum import Enum


class GetApiV1QuerySchemaResponse200AppFunctionsItemKeyKind(str, Enum):
    SPAN = "span"
    TEXT = "text"
    THREAD = "thread"
    TRACE = "trace"

    def __str__(self) -> str:
        return str(self.value)
