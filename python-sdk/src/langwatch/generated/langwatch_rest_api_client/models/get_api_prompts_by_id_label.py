from enum import Enum


class GetApiPromptsByIdLabel(str, Enum):
    PRODUCTION = "production"
    STAGING = "staging"

    def __str__(self) -> str:
        return str(self.value)
