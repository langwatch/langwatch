from enum import Enum


class CreateApiKeyBodyKeyType(str, Enum):
    PERSONAL = "personal"
    SERVICE = "service"

    def __str__(self) -> str:
        return str(self.value)
