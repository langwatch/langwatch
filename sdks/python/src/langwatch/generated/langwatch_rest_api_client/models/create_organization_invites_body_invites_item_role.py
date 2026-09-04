from enum import Enum


class CreateOrganizationInvitesBodyInvitesItemRole(str, Enum):
    ADMIN = "ADMIN"
    EXTERNAL = "EXTERNAL"
    MEMBER = "MEMBER"

    def __str__(self) -> str:
        return str(self.value)
