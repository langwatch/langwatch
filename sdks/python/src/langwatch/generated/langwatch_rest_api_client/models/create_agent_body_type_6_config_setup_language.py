from enum import Enum


class CreateAgentBodyType6ConfigSetupLanguage(str, Enum):
    PYTHON = "python"

    def __str__(self) -> str:
        return str(self.value)
