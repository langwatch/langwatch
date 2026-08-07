from enum import Enum


class PostApiGatewayV1BudgetsResponse201BudgetScopeType(str, Enum):
    ATTRIBUTED_USER = "attributed_user"
    GROUP = "group"
    ORGANIZATION = "organization"
    PRINCIPAL = "principal"
    PROJECT = "project"
    TEAM = "team"
    VIRTUAL_KEY = "virtual_key"

    def __str__(self) -> str:
        return str(self.value)
