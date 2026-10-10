from enum import Enum


class ListGrantsStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"

    def __str__(self) -> str:
        return str(self.value)
