from enum import Enum


class PostApiAnalyticsBodyTimeScaleType0(str, Enum):
    FULL = "full"

    def __str__(self) -> str:
        return str(self.value)
