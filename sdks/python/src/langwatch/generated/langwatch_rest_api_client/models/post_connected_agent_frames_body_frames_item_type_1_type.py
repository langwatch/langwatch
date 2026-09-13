from enum import Enum


class PostConnectedAgentFramesBodyFramesItemType1Type(str, Enum):
    RESULT = "result"

    def __str__(self) -> str:
        return str(self.value)
