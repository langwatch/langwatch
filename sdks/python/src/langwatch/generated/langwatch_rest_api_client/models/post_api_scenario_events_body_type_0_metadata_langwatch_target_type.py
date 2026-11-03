from enum import Enum


class PostApiScenarioEventsBodyType0MetadataLangwatchTargetType(str, Enum):
    CODE = "code"
    CONNECTED = "connected"
    CONNECTOR = "connector"
    HTTP = "http"
    PROMPT = "prompt"
    VOICE = "voice"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
