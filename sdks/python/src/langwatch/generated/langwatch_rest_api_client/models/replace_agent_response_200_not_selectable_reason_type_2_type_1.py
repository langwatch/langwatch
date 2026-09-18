from enum import Enum


class ReplaceAgentResponse200NotSelectableReasonType2Type1(str, Enum):
    OWNED_BY_ANOTHER_PERSON = "owned_by_another_person"

    def __str__(self) -> str:
        return str(self.value)
