from enum import Enum


class GetGrantResponse200PrincipalType(str, Enum):
    APIKEY = "apiKey"
    GROUP = "group"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
