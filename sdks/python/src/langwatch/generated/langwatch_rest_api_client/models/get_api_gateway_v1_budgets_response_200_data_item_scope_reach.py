from enum import Enum


class GetApiGatewayV1BudgetsResponse200DataItemScopeReach(str, Enum):
    REACHABLE = "reachable"
    UNREACHABLE = "unreachable"

    def __str__(self) -> str:
        return str(self.value)
