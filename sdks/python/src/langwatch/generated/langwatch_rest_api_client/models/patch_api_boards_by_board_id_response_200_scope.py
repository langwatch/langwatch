from enum import Enum


class PatchApiBoardsByBoardIdResponse200Scope(str, Enum):
    ORGANIZATION = "ORGANIZATION"
    PRIVATE = "PRIVATE"
    PROJECT = "PROJECT"

    def __str__(self) -> str:
        return str(self.value)
