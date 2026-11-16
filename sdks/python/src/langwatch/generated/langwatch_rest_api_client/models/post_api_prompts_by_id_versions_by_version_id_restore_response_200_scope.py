from enum import Enum


class PostApiPromptsByIdVersionsByVersionIdRestoreResponse200Scope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
