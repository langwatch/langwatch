from enum import Enum


class GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemKind(str, Enum):
    EVAL = "eval"
    EXTRACTION = "extraction"

    def __str__(self) -> str:
        return str(self.value)
