from enum import Enum


class PostApiGatewayV1BudgetsResponse201BudgetWindow(str, Enum):
    DAY = "day"
    HOUR = "hour"
    MANUAL = "manual"
    MINUTE = "minute"
    MONTH = "month"
    TOTAL = "total"
    WEEK = "week"

    def __str__(self) -> str:
        return str(self.value)
