from enum import Enum


class ListRoleBindingsResponse200BindingsItemPrincipalType(str, Enum):
    APIKEY = "apiKey"
    GROUP = "group"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
