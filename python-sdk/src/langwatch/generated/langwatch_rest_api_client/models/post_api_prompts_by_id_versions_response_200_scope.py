from enum import Enum


class PostApiPromptsByIdVersionsResponse200Scope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
