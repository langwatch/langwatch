from enum import Enum


class ListOrganizationInvitesResponse200InvitesItemRole(str, Enum):
    ADMIN = "ADMIN"
    EXTERNAL = "EXTERNAL"
    MEMBER = "MEMBER"

    def __str__(self) -> str:
        return str(self.value)
