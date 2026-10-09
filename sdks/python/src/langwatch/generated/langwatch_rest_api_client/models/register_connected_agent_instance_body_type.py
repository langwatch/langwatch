from enum import Enum


class RegisterConnectedAgentInstanceBodyType(str, Enum):
    REGISTER = "register"

    def __str__(self) -> str:
        return str(self.value)
