from enum import Enum


class PatchApiSuitesByIdResponse200Kind(str, Enum):
    CUSTOM = "custom"
    FOLDER = "folder"

    def __str__(self) -> str:
        return str(self.value)
