from enum import Enum


class PutApiPromptsByIdResponse200ResponseFormatType(str, Enum):
    JSON_SCHEMA = "json_schema"

    def __str__(self) -> str:
        return str(self.value)
