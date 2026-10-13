from enum import Enum


class LangyLocalReadCallResponse200State(str, Enum):
    AWAITING_PERMISSION = "awaiting_permission"
    DONE = "done"
    PENDING = "pending"
    RUNNING = "running"

    def __str__(self) -> str:
        return str(self.value)
