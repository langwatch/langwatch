from enum import Enum


class PostApiScenarioEventsBodyType1Status(str, Enum):
    CANCELLED = "CANCELLED"
    ERROR = "ERROR"
    FAILED = "FAILED"
    IN_PROGRESS = "IN_PROGRESS"
    PENDING = "PENDING"
    SUCCESS = "SUCCESS"

    def __str__(self) -> str:
        return str(self.value)
