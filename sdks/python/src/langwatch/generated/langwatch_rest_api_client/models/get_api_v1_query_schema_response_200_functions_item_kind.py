from enum import Enum


class GetApiV1QuerySchemaResponse200FunctionsItemKind(str, Enum):
    EVAL = "eval"
    EXTRACTION = "extraction"

    def __str__(self) -> str:
        return str(self.value)
