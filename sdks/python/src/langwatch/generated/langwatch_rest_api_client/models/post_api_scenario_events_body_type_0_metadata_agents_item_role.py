from enum import Enum


class PostApiScenarioEventsBodyType0MetadataAgentsItemRole(str, Enum):
    AGENT = "agent"
    JUDGE = "judge"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
