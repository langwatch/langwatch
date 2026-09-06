from enum import Enum


class PostApiGatewayV1BudgetsResponse201BudgetOnBreach(str, Enum):
    BLOCK = "block"
    WARN = "warn"

    def __str__(self) -> str:
        return str(self.value)
