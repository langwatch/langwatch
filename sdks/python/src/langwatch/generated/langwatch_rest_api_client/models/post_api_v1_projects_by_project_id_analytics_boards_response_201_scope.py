from enum import Enum


class PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201Scope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PRIVATE = "PRIVATE"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
