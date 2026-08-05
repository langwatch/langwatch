from enum import Enum


class PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatType(str, Enum):
    JSON_SCHEMA = "json_schema"

    def __str__(self) -> str:
        return str(self.value)
