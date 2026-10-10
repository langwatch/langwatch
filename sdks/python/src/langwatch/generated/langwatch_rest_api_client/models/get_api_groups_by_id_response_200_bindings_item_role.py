from enum import Enum


class GetApiGroupsByIdResponse200BindingsItemRole(str, Enum):
    ADMIN = "ADMIN"
    CUSTOM = "CUSTOM"
    MEMBER = "MEMBER"
    VIEWER = "VIEWER"

    def __str__(self) -> str:
        return str(self.value)
