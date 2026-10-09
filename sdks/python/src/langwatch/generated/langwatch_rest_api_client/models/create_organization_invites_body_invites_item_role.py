from enum import Enum


class CreateOrganizationInvitesBodyInvitesItemRole(str, Enum):
    ADMIN = "ADMIN"
    DEVELOPER = "DEVELOPER"
    EXTERNAL = "EXTERNAL"
    MEMBER = "MEMBER"

    def __str__(self) -> str:
        return str(self.value)
