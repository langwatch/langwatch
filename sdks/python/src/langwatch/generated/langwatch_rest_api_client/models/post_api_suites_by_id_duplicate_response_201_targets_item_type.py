from enum import Enum


class PostApiSuitesByIdDuplicateResponse201TargetsItemType(str, Enum):
    CODE = "code"
    CONNECTED = "connected"
    HTTP = "http"
    PROMPT = "prompt"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
