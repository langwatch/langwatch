from enum import Enum


class PostApiCheckupRunResponse200RowsItemVerdictOutcome(str, Enum):
    REFUSED = "refused"
    UNCHECKED = "unchecked"
    VERIFIED = "verified"

    def __str__(self) -> str:
        return str(self.value)
