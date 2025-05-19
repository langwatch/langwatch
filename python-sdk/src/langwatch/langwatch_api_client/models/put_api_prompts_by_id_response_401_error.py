from enum import Enum


class PutApiPromptsByIdResponse401Error(str, Enum):
    UNAUTHORIZED = "Unauthorized"

    def __str__(self) -> str:
        return str(self.value)
