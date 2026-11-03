from enum import Enum


class CreateAgentBodyType6ConfigTeardownLanguage(str, Enum):
    PYTHON = "python"

    def __str__(self) -> str:
        return str(self.value)
