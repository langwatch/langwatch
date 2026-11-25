from enum import Enum


class GetPlatformHealthResponse503ChecksItemName(str, Enum):
    COLLECTOR = "collector"
    EVALUATIONS = "evaluations"
    PROCESSOR = "processor"
    TRIGGERS = "triggers"
    WORKFLOWS = "workflows"

    def __str__(self) -> str:
        return str(self.value)
