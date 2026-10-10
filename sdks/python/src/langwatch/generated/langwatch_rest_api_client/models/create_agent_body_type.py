from enum import Enum


class CreateAgentBodyType(str, Enum):
    CODE = "code"
    CONNECTED = "connected"
    HTTP = "http"
    SIGNATURE = "signature"
    VOICE = "voice"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
