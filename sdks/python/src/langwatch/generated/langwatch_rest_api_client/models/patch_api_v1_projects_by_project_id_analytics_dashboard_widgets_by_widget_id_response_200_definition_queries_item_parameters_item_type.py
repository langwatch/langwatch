from enum import Enum


class PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200DefinitionQueriesItemParametersItemType(
    str, Enum
):
    BOOLEAN = "boolean"
    NUMBER = "number"
    STRING = "string"

    def __str__(self) -> str:
        return str(self.value)
