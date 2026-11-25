from enum import Enum


class PatchApiTriggersByIdResponse200Kind(str, Enum):
    ALERT = "ALERT"
    AUTOMATION = "AUTOMATION"
    REPORT = "REPORT"

    def __str__(self) -> str:
        return str(self.value)
