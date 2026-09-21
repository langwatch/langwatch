from enum import Enum


class RunRunPlanBodyConfigTargetsItemType(str, Enum):
    CODE = "code"
    CONNECTED = "connected"
    HTTP = "http"
    PROMPT = "prompt"
    VOICE = "voice"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
