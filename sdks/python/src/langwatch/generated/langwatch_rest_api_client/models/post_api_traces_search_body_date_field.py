from enum import Enum


class PostApiTracesSearchBodyDateField(str, Enum):
    OCCURRED = "occurred"
    UPDATED = "updated"

    def __str__(self) -> str:
        return str(self.value)
