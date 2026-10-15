from enum import Enum


class GetApiV1ProjectsByProjectIdAnalyticsBoardsResponse200DataItemScope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PRIVATE = "PRIVATE"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
