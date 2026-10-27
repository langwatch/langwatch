from enum import Enum


class PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemParametersItemType(str, Enum):
    BOOLEAN = "boolean"
    NUMBER = "number"
    STRING = "string"

    def __str__(self) -> str:
        return str(self.value)
