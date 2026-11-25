from enum import Enum


class ListStaffAccessFunctionsResponse200ItemsItemScope(str, Enum):
    LOOKUP = "lookup"
    ORG = "org"
    PLATFORM = "platform"

    def __str__(self) -> str:
        return str(self.value)
