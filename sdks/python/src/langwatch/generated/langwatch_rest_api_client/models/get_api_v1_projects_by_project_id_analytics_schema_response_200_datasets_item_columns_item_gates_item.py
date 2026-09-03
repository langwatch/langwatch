from enum import Enum


class GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemGatesItem(str, Enum):
    COSTS = "costs"
    INPUT = "input"
    OUTPUT = "output"

    def __str__(self) -> str:
        return str(self.value)
