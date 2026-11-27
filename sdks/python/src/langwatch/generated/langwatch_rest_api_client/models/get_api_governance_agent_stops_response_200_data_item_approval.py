from enum import Enum


class GetApiGovernanceAgentStopsResponse200DataItemApproval(str, Enum):
    IMMEDIATE = "immediate"
    REQUIRED = "required"

    def __str__(self) -> str:
        return str(self.value)
