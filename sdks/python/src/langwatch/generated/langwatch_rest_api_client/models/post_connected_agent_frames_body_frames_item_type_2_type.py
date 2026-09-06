from enum import Enum


class PostConnectedAgentFramesBodyFramesItemType2Type(str, Enum):
    DEREGISTER = "deregister"

    def __str__(self) -> str:
        return str(self.value)
