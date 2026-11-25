from enum import Enum


class GetApiTriggersByIdResponse200AlertTypeType0(str, Enum):
    CRITICAL = "CRITICAL"
    INFO = "INFO"
    WARNING = "WARNING"

    def __str__(self) -> str:
        return str(self.value)
