from enum import Enum


class DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200Scope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PRIVATE = "PRIVATE"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
