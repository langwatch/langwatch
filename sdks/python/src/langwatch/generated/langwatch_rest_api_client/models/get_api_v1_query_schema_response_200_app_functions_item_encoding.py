from enum import Enum


class GetApiV1QuerySchemaResponse200AppFunctionsItemEncoding(str, Enum):
    JSON = "json"
    TEXT = "text"

    def __str__(self) -> str:
        return str(self.value)
