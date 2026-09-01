from enum import Enum


class ListAgentsResponse200DataItemStatus(str, Enum):
    OFFLINE = "offline"
    ONLINE = "online"

    def __str__(self) -> str:
        return str(self.value)
