from enum import Enum


class CreateAgentResponse201Status(str, Enum):
    OFFLINE = "offline"
    ONLINE = "online"

    def __str__(self) -> str:
        return str(self.value)
