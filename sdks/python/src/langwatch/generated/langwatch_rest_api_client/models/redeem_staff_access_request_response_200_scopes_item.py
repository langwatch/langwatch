from enum import Enum


class RedeemStaffAccessRequestResponse200ScopesItem(str, Enum):
    COPYSOURCE = "copy:source"
    COPYTARGET = "copy:target"
    OPSREAD = "ops:read"
    ORGCONTENT = "org:content"
    ORGMETADATA = "org:metadata"
    ORGSUPPORT = "org:support"

    def __str__(self) -> str:
        return str(self.value)
