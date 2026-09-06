from enum import Enum


class ListOrganizationMembersResponse200MembersItemRole(str, Enum):
    ADMIN = "ADMIN"
    EXTERNAL = "EXTERNAL"
    MEMBER = "MEMBER"

    def __str__(self) -> str:
        return str(self.value)
