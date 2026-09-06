from enum import Enum


class ListTestSuitesResponse200ItemFieldsItemType(str, Enum):
    BOOLEAN = "boolean"
    NUMBER = "number"
    TEXT = "text"

    def __str__(self) -> str:
        return str(self.value)
