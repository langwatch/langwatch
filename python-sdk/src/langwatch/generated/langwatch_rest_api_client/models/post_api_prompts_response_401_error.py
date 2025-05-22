from enum import Enum


class PostApiPromptsResponse401Error(str, Enum):
    UNAUTHORIZED = "Unauthorized"

    def __str__(self) -> str:
        return str(self.value)
