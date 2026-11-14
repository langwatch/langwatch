from enum import Enum


class GetApiGovernanceRegistryEventsResponse200DataItemAgentStatus(str, Enum):
    ACTIVE = "active"
    REMOVED = "removed"

    def __str__(self) -> str:
        return str(self.value)
