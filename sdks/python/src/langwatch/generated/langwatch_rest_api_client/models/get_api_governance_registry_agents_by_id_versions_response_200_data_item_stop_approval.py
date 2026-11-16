from enum import Enum


class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemStopApproval(str, Enum):
    IMMEDIATE = "immediate"
    REQUIRED = "required"

    def __str__(self) -> str:
        return str(self.value)
