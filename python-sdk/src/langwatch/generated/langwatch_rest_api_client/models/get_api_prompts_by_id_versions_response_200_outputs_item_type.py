from enum import Enum


class GetApiPromptsByIdVersionsResponse200OutputsItemType(str, Enum):
    BOOL = "bool"
    FLOAT = "float"
    JSON_SCHEMA = "json_schema"
    STR = "str"

    def __str__(self) -> str:
        return str(self.value)
