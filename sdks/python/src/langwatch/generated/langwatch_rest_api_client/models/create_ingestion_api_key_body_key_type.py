from enum import Enum


class CreateIngestionApiKeyBodyKeyType(str, Enum):
    PERSONAL = "personal"
    SERVICE = "service"

    def __str__(self) -> str:
        return str(self.value)
