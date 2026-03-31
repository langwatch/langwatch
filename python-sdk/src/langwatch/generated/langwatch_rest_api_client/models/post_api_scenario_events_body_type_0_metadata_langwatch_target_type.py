from enum import Enum


class PostApiScenarioEventsBodyType0MetadataLangwatchTargetType(str, Enum):
    CODE = "code"
    HTTP = "http"
    PROMPT = "prompt"

    def __str__(self) -> str:
        return str(self.value)
