from enum import Enum


class PutApiPromptsByIdResponse400Error(str, Enum):
    BAD_REQUEST = "Bad Request"

    def __str__(self) -> str:
        return str(self.value)
