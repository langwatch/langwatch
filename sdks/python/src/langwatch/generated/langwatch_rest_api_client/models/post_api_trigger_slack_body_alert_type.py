from enum import Enum


class PostApiTriggerSlackBodyAlertType(str, Enum):
    CRITICAL = "CRITICAL"
    INFO = "INFO"
    WARNING = "WARNING"

    def __str__(self) -> str:
        return str(self.value)
