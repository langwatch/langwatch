from enum import Enum


class PostApiTriggersBodyType3GraphAlertOperator(str, Enum):
    EQ = "eq"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"

    def __str__(self) -> str:
        return str(self.value)
