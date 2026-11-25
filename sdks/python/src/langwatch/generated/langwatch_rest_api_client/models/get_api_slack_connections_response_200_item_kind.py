from enum import Enum


class GetApiSlackConnectionsResponse200ItemKind(str, Enum):
    BOT = "bot"
    WEBHOOK = "webhook"

    def __str__(self) -> str:
        return str(self.value)
