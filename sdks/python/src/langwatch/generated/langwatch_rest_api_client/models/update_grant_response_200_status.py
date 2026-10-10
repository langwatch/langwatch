from enum import Enum


class UpdateGrantResponse200Status(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"

    def __str__(self) -> str:
        return str(self.value)
