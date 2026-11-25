from enum import Enum


class ReadCliIngestionKeyStateResponse200Status(str, Enum):
    LIVE = "live"
    REVOKED = "revoked"
    UNKNOWN = "unknown"

    def __str__(self) -> str:
        return str(self.value)
