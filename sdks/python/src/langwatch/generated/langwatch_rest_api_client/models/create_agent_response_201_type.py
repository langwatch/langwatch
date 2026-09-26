from enum import Enum


class CreateAgentResponse201Type(str, Enum):
    CODE = "code"
    CONNECTED = "connected"
    HTTP = "http"
    SIGNATURE = "signature"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
