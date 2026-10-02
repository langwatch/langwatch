from enum import Enum


class UpdateProjectBodyPiiRedactionLevel(str, Enum):
    DISABLED = "DISABLED"
    ESSENTIAL = "ESSENTIAL"
    STRICT = "STRICT"

    def __str__(self) -> str:
        return str(self.value)
