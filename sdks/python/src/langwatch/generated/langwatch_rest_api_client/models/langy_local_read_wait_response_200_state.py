from enum import Enum


class LangyLocalReadWaitResponse200State(str, Enum):
    ANSWERED = "answered"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
