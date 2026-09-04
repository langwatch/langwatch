from enum import Enum


class UpdateOrganizationMemberBodyRole(str, Enum):
    ADMIN = "ADMIN"
    EXTERNAL = "EXTERNAL"
    MEMBER = "MEMBER"

    def __str__(self) -> str:
        return str(self.value)
