from enum import Enum


class PostApiGovernanceAgentStopsByIdDenyResponse200DataStatus(str, Enum):
    DENIED = "denied"
    PENDING_APPROVAL = "pending_approval"
    QUARANTINED = "quarantined"
    RESTORED = "restored"
    RESTORE_FAILED = "restore_failed"
    RESTORING = "restoring"
    STOPPING = "stopping"
    STOP_FAILED = "stop_failed"

    def __str__(self) -> str:
        return str(self.value)
