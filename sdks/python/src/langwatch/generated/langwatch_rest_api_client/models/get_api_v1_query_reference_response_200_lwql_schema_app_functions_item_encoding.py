from enum import Enum


class GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemEncoding(str, Enum):
    JSON = "json"
    TEXT = "text"

    def __str__(self) -> str:
        return str(self.value)
