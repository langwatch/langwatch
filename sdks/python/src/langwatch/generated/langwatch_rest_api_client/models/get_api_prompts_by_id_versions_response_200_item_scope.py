from enum import Enum


class GetApiPromptsByIdVersionsResponse200ItemScope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
