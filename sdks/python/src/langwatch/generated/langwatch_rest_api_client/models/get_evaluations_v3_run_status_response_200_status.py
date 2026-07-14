from enum import Enum


class GetEvaluationsV3RunStatusResponse200Status(str, Enum):
    COMPLETED = "completed"
    FAILED = "failed"
    PENDING = "pending"
    RUNNING = "running"
    STOPPED = "stopped"

    def __str__(self) -> str:
        return str(self.value)
