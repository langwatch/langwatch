from enum import Enum


class UpdateProjectResponse200PiiRedactionLevel(str, Enum):
    DISABLED = "DISABLED"
    ESSENTIAL = "ESSENTIAL"
    STRICT = "STRICT"

    def __str__(self) -> str:
        return str(self.value)
