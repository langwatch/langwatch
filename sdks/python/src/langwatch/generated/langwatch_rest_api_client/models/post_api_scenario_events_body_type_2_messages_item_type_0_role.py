from enum import Enum


class PostApiScenarioEventsBodyType2MessagesItemType0Role(str, Enum):
    ACTIVITY = "activity"
    ASSISTANT = "assistant"
    DEVELOPER = "developer"
    REASONING = "reasoning"
    SYSTEM = "system"
    TOOL = "tool"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
