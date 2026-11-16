from enum import Enum


class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemStopSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    LOW = "low"
    MEDIUM = "medium"

    def __str__(self) -> str:
        return str(self.value)
