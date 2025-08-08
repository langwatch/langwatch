from enum import Enum


class PostApiPromptsByIdSyncResponse200Action(str, Enum):
    CONFLICT = "conflict"
    CREATED = "created"
    UPDATED = "updated"
    UP_TO_DATE = "up_to_date"

    def __str__(self) -> str:
        return str(self.value)
