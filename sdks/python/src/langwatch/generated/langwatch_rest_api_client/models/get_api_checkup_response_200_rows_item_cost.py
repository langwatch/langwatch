from enum import Enum


class GetApiCheckupResponse200RowsItemCost(str, Enum):
    EGRESS = "egress"
    FREE = "free"
    PAID = "paid"

    def __str__(self) -> str:
        return str(self.value)
