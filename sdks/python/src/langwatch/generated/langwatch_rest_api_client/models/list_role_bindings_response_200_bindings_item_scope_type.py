from enum import Enum


class ListRoleBindingsResponse200BindingsItemScopeType(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PROJECT = "PROJECT"
    TEAM = "TEAM"

    def __str__(self) -> str:
        return str(self.value)
