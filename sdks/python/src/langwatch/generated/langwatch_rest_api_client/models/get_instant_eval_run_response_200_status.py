from enum import Enum


class GetInstantEvalRunResponse200Status(str, Enum):
    CANCELLED = "cancelled"
    FAILED = "failed"
    FINISHED = "finished"
    PLANNING = "planning"
    QUEUED = "queued"
    RUNNING = "running"

    def __str__(self) -> str:
        return str(self.value)
