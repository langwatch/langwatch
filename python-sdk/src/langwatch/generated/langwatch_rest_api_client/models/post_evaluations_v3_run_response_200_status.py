from enum import Enum


class PostEvaluationsV3RunResponse200Status(str, Enum):
    RUNNING = "running"

    def __str__(self) -> str:
        return str(self.value)
