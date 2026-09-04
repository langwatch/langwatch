from enum import Enum


class PostApiScenarioEventsBodyType0MetadataLangwatchActorLabel(str, Enum):
    API = "api"
    CLI = "cli"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
