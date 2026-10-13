from enum import Enum


class CreateGrantResponse201Status(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"

    def __str__(self) -> str:
        return str(self.value)
