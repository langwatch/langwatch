from enum import Enum


class PostApiEvaluationsByEvaluatorEvaluateResponse200Status(str, Enum):
    COMPLETED = "completed"
    FAILED = "failed"
    PENDING = "pending"
    RUNNING = "running"

    def __str__(self) -> str:
        return str(self.value)
