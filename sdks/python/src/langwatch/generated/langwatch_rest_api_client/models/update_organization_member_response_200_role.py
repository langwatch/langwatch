from enum import Enum


class UpdateOrganizationMemberResponse200Role(str, Enum):
    ADMIN = "ADMIN"
    EXTERNAL = "EXTERNAL"
    MEMBER = "MEMBER"

    def __str__(self) -> str:
        return str(self.value)
