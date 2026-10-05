from enum import Enum


class GetApiV1QueryReferenceResponse200TraceFilterFieldsItemValueType(str, Enum):
    CATEGORICAL = "categorical"
    EXISTENCE = "existence"
    RANGE = "range"
    TEXT = "text"

    def __str__(self) -> str:
        return str(self.value)
