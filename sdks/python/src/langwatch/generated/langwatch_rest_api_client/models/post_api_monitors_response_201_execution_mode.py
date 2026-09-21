from enum import Enum


class PostApiMonitorsResponse201ExecutionMode(str, Enum):
    AS_GUARDRAIL = "AS_GUARDRAIL"
    MANUALLY = "MANUALLY"
    ON_MESSAGE = "ON_MESSAGE"

    def __str__(self) -> str:
        return str(self.value)
