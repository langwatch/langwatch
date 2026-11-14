from enum import Enum


class PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataStatus(str, Enum):
    ACTIVE = "active"
    REMOVED = "removed"

    def __str__(self) -> str:
        return str(self.value)
