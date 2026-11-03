from enum import Enum


class GetStaffAccessRequestResponse200Status(str, Enum):
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"
    PENDING = "pending"
    REDEEMED = "redeemed"
    REVOKED = "revoked"

    def __str__(self) -> str:
        return str(self.value)
