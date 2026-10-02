from enum import Enum


class ListGrantsScopeType(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"
    TEAM = "team"

    def __str__(self) -> str:
        return str(self.value)
