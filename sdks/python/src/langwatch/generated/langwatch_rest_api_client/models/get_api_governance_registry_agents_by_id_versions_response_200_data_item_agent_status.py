from enum import Enum


class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentStatus(str, Enum):
    ACTIVE = "active"
    REMOVED = "removed"

    def __str__(self) -> str:
        return str(self.value)
