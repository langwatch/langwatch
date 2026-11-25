from enum import Enum


class GetApiGatewayV1SpendSummariesBucket(str, Enum):
    DAY = "day"
    HOUR = "hour"
    NONE = "none"

    def __str__(self) -> str:
        return str(self.value)
