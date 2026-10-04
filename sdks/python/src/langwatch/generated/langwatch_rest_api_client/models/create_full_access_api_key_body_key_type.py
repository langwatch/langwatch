from enum import Enum


class CreateFullAccessApiKeyBodyKeyType(str, Enum):
    PERSONAL = "personal"
    SERVICE = "service"

    def __str__(self) -> str:
        return str(self.value)
