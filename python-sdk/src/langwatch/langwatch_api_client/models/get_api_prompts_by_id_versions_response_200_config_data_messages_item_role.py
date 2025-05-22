from enum import Enum


class GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItemRole(str, Enum):
    ASSISTANT = "assistant"
    SYSTEM = "system"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
