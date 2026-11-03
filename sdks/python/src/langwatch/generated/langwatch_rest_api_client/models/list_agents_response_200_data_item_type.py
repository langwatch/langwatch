from enum import Enum


class ListAgentsResponse200DataItemType(str, Enum):
    CODE = "code"
    CONNECTED = "connected"
    CONNECTOR = "connector"
    HTTP = "http"
    SIGNATURE = "signature"
    VOICE = "voice"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
