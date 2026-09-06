from enum import Enum


class PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0Window(str, Enum):
    DAY = "day"
    MONTH = "month"
    WEEK = "week"

    def __str__(self) -> str:
        return str(self.value)
