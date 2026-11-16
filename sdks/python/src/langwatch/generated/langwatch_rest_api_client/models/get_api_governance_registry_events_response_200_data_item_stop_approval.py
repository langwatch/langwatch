from enum import Enum


class GetApiGovernanceRegistryEventsResponse200DataItemStopApproval(str, Enum):
    IMMEDIATE = "immediate"
    REQUIRED = "required"

    def __str__(self) -> str:
        return str(self.value)
