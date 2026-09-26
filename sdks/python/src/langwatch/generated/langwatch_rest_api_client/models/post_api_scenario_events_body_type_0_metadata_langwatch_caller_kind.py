from enum import Enum


class PostApiScenarioEventsBodyType0MetadataLangwatchCallerKind(str, Enum):
    HUMAN = "human"
    SIMULATED = "simulated"

    def __str__(self) -> str:
        return str(self.value)
