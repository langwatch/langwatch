from enum import Enum


class CreateAgentBodyType5ConfigType1CallDirection(str, Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"

    def __str__(self) -> str:
        return str(self.value)
