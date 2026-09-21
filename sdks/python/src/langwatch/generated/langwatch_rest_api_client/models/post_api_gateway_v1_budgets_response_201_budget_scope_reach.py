from enum import Enum


class PostApiGatewayV1BudgetsResponse201BudgetScopeReach(str, Enum):
    REACHABLE = "reachable"
    UNREACHABLE = "unreachable"

    def __str__(self) -> str:
        return str(self.value)
