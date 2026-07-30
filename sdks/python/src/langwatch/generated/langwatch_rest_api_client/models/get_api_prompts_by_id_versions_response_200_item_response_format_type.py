from enum import Enum


class GetApiPromptsByIdVersionsResponse200ItemResponseFormatType(str, Enum):
    JSON_SCHEMA = "json_schema"

    def __str__(self) -> str:
        return str(self.value)
