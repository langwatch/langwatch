from enum import Enum


class PostApiDashboardsResponse201Scope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PRIVATE = "PRIVATE"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
