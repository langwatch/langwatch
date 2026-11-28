from enum import Enum


class UpdateAgentResponse200Type(str, Enum):
    CODE = "code"
    CONNECTED = "connected"
    CONNECTOR = "connector"
    HTTP = "http"
    SIGNATURE = "signature"
    VOICE = "voice"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
