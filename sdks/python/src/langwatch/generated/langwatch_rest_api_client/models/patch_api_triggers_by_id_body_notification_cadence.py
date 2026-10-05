from enum import Enum


class PatchApiTriggersByIdBodyNotificationCadence(str, Enum):
    HOURLY_DIGEST = "hourly_digest"
    IMMEDIATE = "immediate"
    VALUE_1 = "5min_digest"
    VALUE_2 = "15min_digest"

    def __str__(self) -> str:
        return str(self.value)
