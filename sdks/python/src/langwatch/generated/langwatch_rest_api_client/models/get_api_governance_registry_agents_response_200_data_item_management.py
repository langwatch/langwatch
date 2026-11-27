from enum import Enum


class GetApiGovernanceRegistryAgentsResponse200DataItemManagement(str, Enum):
    DISCOVERED = "discovered"
    MANAGED = "managed"
    OBSERVED = "observed"

    def __str__(self) -> str:
        return str(self.value)
