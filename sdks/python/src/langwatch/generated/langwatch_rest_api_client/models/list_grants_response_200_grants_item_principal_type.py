from enum import Enum


class ListGrantsResponse200GrantsItemPrincipalType(str, Enum):
    APIKEY = "apiKey"
    GROUP = "group"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
