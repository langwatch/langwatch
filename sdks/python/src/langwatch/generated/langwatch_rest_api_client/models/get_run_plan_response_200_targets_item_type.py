from enum import Enum


class GetRunPlanResponse200TargetsItemType(str, Enum):
    CODE = "code"
    HTTP = "http"
    PROMPT = "prompt"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
