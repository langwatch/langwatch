from enum import Enum


class ListGrantsResponse200GrantsItemStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"

    def __str__(self) -> str:
        return str(self.value)
