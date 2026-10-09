from enum import Enum


class UpdateTestSuiteBodyFieldsItemType(str, Enum):
    BOOLEAN = "boolean"
    NUMBER = "number"
    TEXT = "text"

    def __str__(self) -> str:
        return str(self.value)
