from enum import Enum


class PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Status(str, Enum):
    ERROR = "error"
    IDLE = "idle"
    RUNNING = "running"
    SKIPPED = "skipped"
    SUCCESS = "success"
    WAITING = "waiting"

    def __str__(self) -> str:
        return str(self.value)
