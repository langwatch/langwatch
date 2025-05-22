from enum import Enum


class GetApiPromptsResponse200ItemResponseFormatType0Type(str, Enum):
    JSON_SCHEMA = "json_schema"

    def __str__(self) -> str:
        return str(self.value)
