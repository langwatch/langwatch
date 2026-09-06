from enum import Enum


class UpdateApiKeyResponse200KeyType(str, Enum):
    PERSONAL = "personal"
    SERVICE = "service"

    def __str__(self) -> str:
        return str(self.value)
