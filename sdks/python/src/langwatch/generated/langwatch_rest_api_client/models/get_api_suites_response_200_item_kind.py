from enum import Enum


class GetApiSuitesResponse200ItemKind(str, Enum):
    CUSTOM = "custom"
    FOLDER = "folder"

    def __str__(self) -> str:
        return str(self.value)
