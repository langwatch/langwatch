from enum import Enum


class RedeemStaffAccessRequestResponse200ScopesItem(str, Enum):
    OPSREAD = "ops:read"
    ORGCONTENT = "org:content"
    ORGMETADATA = "org:metadata"
    ORGSUPPORT = "org:support"

    def __str__(self) -> str:
        return str(self.value)
