from enum import Enum


class CallConnectedAgentBodyKind(str, Enum):
    SETUP = "setup"
    TEARDOWN = "teardown"
    TURN = "turn"

    def __str__(self) -> str:
        return str(self.value)
