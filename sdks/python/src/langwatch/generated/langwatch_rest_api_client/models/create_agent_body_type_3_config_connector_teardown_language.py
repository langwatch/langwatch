from enum import Enum


class CreateAgentBodyType3ConfigConnectorTeardownLanguage(str, Enum):
    PYTHON = "python"

    def __str__(self) -> str:
        return str(self.value)
