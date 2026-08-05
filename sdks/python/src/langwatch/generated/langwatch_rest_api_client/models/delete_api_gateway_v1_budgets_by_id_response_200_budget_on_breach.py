from enum import Enum


class DeleteApiGatewayV1BudgetsByIdResponse200BudgetOnBreach(str, Enum):
    BLOCK = "block"
    WARN = "warn"

    def __str__(self) -> str:
        return str(self.value)
