from enum import Enum


class RunRunPlanResponse200ItemsItemTargetType(str, Enum):
    CODE = "code"
    CONNECTED = "connected"
    CONNECTOR = "connector"
    HTTP = "http"
    PROMPT = "prompt"
    VOICE = "voice"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
