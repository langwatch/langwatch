from enum import Enum


class GetApiGatewayV1EndUsersByIdSpendWindow(str, Enum):
    DAY = "day"
    MONTH = "month"
    WEEK = "week"

    def __str__(self) -> str:
        return str(self.value)
