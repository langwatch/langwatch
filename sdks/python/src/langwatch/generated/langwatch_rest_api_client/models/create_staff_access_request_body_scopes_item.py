from enum import Enum


class CreateStaffAccessRequestBodyScopesItem(str, Enum):
    OPSCOPY = "ops:copy"
    OPSREAD = "ops:read"
    ORGCONTENT = "org:content"
    ORGMETADATA = "org:metadata"
    ORGSUPPORT = "org:support"

    def __str__(self) -> str:
        return str(self.value)
