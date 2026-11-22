from enum import Enum


class PollConnectedAgentInstanceResponse200FramesItemType0Kind(str, Enum):
    SETUP = "setup"
    TEARDOWN = "teardown"
    TURN = "turn"

    def __str__(self) -> str:
        return str(self.value)
