from enum import Enum


class GetApiPromptsByIdResponse200ResponseFormatType0Type(str, Enum):
    JSON_SCHEMA = "json_schema"

    def __str__(self) -> str:
        return str(self.value)
