from enum import Enum


class PostApiDashboardsByDashboardIdWidgetsResponse201DefinitionQueriesItemParametersItemType(str, Enum):
    BOOLEAN = "boolean"
    NUMBER = "number"
    STRING = "string"

    def __str__(self) -> str:
        return str(self.value)
