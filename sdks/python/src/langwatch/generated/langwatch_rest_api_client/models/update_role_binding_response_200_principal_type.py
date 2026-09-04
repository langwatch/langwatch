from enum import Enum


class UpdateRoleBindingResponse200PrincipalType(str, Enum):
    APIKEY = "apiKey"
    GROUP = "group"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
