from enum import Enum


class CreateAgentBodyType6ConfigCallLanguage(str, Enum):
    PYTHON = "python"

    def __str__(self) -> str:
        return str(self.value)
