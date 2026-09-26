from enum import Enum


class GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItem(str, Enum):
    COSTS = "costs"
    INPUT = "input"
    OUTPUT = "output"

    def __str__(self) -> str:
        return str(self.value)
