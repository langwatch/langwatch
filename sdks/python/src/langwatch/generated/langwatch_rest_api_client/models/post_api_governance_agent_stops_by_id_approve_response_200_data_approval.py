from enum import Enum


class PostApiGovernanceAgentStopsByIdApproveResponse200DataApproval(str, Enum):
    IMMEDIATE = "immediate"
    REQUIRED = "required"

    def __str__(self) -> str:
        return str(self.value)
