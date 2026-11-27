from enum import Enum


class CopyStaffAccessOrganizationResponse200ItemsItemKind(str, Enum):
    DATASET = "dataset"
    EVALUATOR = "evaluator"
    MONITOR = "monitor"
    PROJECT = "project"
    PROMPT = "prompt"

    def __str__(self) -> str:
        return str(self.value)
