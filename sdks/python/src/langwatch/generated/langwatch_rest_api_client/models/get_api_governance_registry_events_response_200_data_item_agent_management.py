from enum import Enum


class GetApiGovernanceRegistryEventsResponse200DataItemAgentManagement(str, Enum):
    DISCOVERED = "discovered"
    MANAGED = "managed"
    OBSERVED = "observed"

    def __str__(self) -> str:
        return str(self.value)
