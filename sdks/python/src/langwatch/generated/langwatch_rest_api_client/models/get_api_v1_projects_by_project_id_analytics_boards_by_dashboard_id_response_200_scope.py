from enum import Enum


class GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200Scope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PRIVATE = "PRIVATE"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
