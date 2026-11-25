from enum import Enum


class CreateFullAccessApiKeyBodyPermissionMode(str, Enum):
    ALL = "all"
    READONLY = "readonly"
    RESTRICTED = "restricted"

    def __str__(self) -> str:
        return str(self.value)
