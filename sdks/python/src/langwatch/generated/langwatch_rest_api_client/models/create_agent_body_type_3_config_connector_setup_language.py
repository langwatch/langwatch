from enum import Enum


class CreateAgentBodyType3ConfigConnectorSetupLanguage(str, Enum):
    PYTHON = "python"

    def __str__(self) -> str:
        return str(self.value)
