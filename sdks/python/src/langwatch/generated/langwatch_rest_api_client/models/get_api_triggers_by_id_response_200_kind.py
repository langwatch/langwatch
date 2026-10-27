from enum import Enum


class GetApiTriggersByIdResponse200Kind(str, Enum):
    ALERT = "ALERT"
    AUTOMATION = "AUTOMATION"
    REPORT = "REPORT"

    def __str__(self) -> str:
        return str(self.value)
