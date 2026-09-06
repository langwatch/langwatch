from enum import Enum


class CreateApiKeyBodyPermissionMode(str, Enum):
    ALL = "all"
    READONLY = "readonly"
    RESTRICTED = "restricted"

    def __str__(self) -> str:
        return str(self.value)
