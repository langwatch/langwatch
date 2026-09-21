from enum import Enum


class DeleteApiGatewayV1BudgetsByIdResponse200BudgetWindow(str, Enum):
    DAY = "day"
    HOUR = "hour"
    MANUAL = "manual"
    MINUTE = "minute"
    MONTH = "month"
    TOTAL = "total"
    WEEK = "week"

    def __str__(self) -> str:
        return str(self.value)
