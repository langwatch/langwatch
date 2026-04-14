from enum import Enum


class PostApiAgentsBodyType(str, Enum):
    CODE = "code"
    HTTP = "http"
    SIGNATURE = "signature"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
