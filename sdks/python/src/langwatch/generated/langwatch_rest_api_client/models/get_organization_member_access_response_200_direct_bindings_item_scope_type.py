from enum import Enum


class GetOrganizationMemberAccessResponse200DirectBindingsItemScopeType(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PROJECT = "PROJECT"
    TEAM = "TEAM"

    def __str__(self) -> str:
        return str(self.value)
