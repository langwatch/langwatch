from enum import Enum


class PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataManagement(str, Enum):
    DISCOVERED = "discovered"
    MANAGED = "managed"
    OBSERVED = "observed"

    def __str__(self) -> str:
        return str(self.value)
