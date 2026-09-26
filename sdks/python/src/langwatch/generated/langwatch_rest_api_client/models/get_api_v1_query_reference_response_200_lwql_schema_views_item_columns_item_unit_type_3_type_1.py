from enum import Enum


class GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemUnitType3Type1(str, Enum):
    MS = "ms"
    TOKENS = "tokens"
    TOKENSS = "tokens/s"
    USD = "USD"

    def __str__(self) -> str:
        return str(self.value)
