from enum import Enum


class GetApiGatewayV1BudgetsByIdResponse200BudgetOnBreach(str, Enum):
    BLOCK = "block"
    WARN = "warn"

    def __str__(self) -> str:
        return str(self.value)
