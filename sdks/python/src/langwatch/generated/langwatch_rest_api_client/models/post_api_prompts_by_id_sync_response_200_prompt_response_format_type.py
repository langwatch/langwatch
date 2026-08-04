from enum import Enum


class PostApiPromptsByIdSyncResponse200PromptResponseFormatType(str, Enum):
    JSON_SCHEMA = "json_schema"

    def __str__(self) -> str:
        return str(self.value)
