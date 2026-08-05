from enum import Enum


class GetApiTriggersResponse200ItemAlertTypeType2Type1(str, Enum):
    CRITICAL = "CRITICAL"
    INFO = "INFO"
    WARNING = "WARNING"

    def __str__(self) -> str:
        return str(self.value)
