from enum import Enum


class ListAgentsResponse200DataItemNotSelectableReasonType0(str, Enum):
    OWNED_BY_ANOTHER_PERSON = "owned_by_another_person"

    def __str__(self) -> str:
        return str(self.value)
