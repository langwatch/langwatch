from enum import Enum


class PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemStatus(str, Enum):
    ACTIVE = "active"
    DEPRECATED = "deprecated"

    def __str__(self) -> str:
        return str(self.value)
