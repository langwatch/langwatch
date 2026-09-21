from enum import Enum


class ListInstantEvalRunResultsMatched(str, Enum):
    FALSE = "false"
    NO = "no"
    TRUE = "true"
    VALUE_1 = "1"
    VALUE_4 = "0"
    YES = "yes"

    def __str__(self) -> str:
        return str(self.value)
