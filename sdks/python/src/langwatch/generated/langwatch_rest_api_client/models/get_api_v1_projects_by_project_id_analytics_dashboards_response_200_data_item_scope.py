from enum import Enum


class GetApiV1ProjectsByProjectIdAnalyticsDashboardsResponse200DataItemScope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PRIVATE = "PRIVATE"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
