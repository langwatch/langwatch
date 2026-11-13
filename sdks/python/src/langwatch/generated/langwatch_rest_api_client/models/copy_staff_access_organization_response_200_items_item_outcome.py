from enum import Enum


class CopyStaffAccessOrganizationResponse200ItemsItemOutcome(str, Enum):
    ALREADY_COPIED = "already_copied"
    COPIED = "copied"
    FAILED = "failed"
    PLANNED = "planned"
    SKIPPED = "skipped"

    def __str__(self) -> str:
        return str(self.value)
