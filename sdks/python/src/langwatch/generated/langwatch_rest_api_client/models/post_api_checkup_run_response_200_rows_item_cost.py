from enum import Enum


class PostApiCheckupRunResponse200RowsItemCost(str, Enum):
    EGRESS = "egress"
    FREE = "free"
    PAID = "paid"

    def __str__(self) -> str:
        return str(self.value)
