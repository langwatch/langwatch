from enum import Enum


class ScimPatchUserBodyOperationsItemOp(str, Enum):
    ADD = "add"
    REMOVE = "remove"
    REPLACE = "replace"

    def __str__(self) -> str:
        return str(self.value)
