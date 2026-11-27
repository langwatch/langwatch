from enum import Enum


class PostApiGovernanceAgentStopsByIdRetryResponse202DataTargetsItemState(str, Enum):
    APPLIED = "applied"
    FAILED = "failed"
    PENDING = "pending"
    REVERTED = "reverted"
    REVERTING = "reverting"
    REVERT_FAILED = "revert_failed"

    def __str__(self) -> str:
        return str(self.value)
