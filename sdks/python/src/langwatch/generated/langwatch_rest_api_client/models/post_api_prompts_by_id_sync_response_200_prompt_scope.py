from enum import Enum


class PostApiPromptsByIdSyncResponse200PromptScope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
