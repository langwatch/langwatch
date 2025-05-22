from enum import Enum


class GetApiPromptsByIdResponse400Error(str, Enum):
    BAD_REQUEST = "Bad Request"

    def __str__(self) -> str:
        return str(self.value)
