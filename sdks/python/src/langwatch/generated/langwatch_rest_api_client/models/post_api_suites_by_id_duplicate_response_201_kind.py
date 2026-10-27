from enum import Enum


class PostApiSuitesByIdDuplicateResponse201Kind(str, Enum):
    CUSTOM = "custom"
    FOLDER = "folder"

    def __str__(self) -> str:
        return str(self.value)
