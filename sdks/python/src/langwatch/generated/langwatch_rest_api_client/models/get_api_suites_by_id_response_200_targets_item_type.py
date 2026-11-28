from enum import Enum


class GetApiSuitesByIdResponse200TargetsItemType(str, Enum):
    CODE = "code"
    CONNECTED = "connected"
    CONNECTOR = "connector"
    HTTP = "http"
    PROMPT = "prompt"
    VOICE = "voice"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
