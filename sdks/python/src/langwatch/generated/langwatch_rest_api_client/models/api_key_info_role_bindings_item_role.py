from enum import Enum


class ApiKeyInfoRoleBindingsItemRole(str, Enum):
    ADMIN = "ADMIN"
    CUSTOM = "CUSTOM"
    MEMBER = "MEMBER"
    VIEWER = "VIEWER"

    def __str__(self) -> str:
        return str(self.value)
