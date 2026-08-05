from enum import Enum


class DeleteApiGatewayV1BudgetsByIdResponse200BudgetScopeType(str, Enum):
    ATTRIBUTED_USER = "attributed_user"
    GROUP = "group"
    ORGANIZATION = "organization"
    PRINCIPAL = "principal"
    PROJECT = "project"
    TEAM = "team"
    VIRTUAL_KEY = "virtual_key"

    def __str__(self) -> str:
        return str(self.value)
