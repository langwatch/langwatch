from enum import Enum


class GetApiSlackConnectionsResponse200ItemScopeType(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
