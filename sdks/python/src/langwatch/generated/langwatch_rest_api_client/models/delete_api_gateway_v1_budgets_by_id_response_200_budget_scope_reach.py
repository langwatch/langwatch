from enum import Enum


class DeleteApiGatewayV1BudgetsByIdResponse200BudgetScopeReach(str, Enum):
    REACHABLE = "reachable"
    UNREACHABLE = "unreachable"

    def __str__(self) -> str:
        return str(self.value)
