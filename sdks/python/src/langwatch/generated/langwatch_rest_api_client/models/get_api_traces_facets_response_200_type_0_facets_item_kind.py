from enum import Enum


class GetApiTracesFacetsResponse200Type0FacetsItemKind(str, Enum):
    CATEGORICAL = "categorical"
    DYNAMIC_KEYS = "dynamic_keys"
    RANGE = "range"

    def __str__(self) -> str:
        return str(self.value)
