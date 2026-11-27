from enum import Enum


class PostApiGovernanceAgentStopsByIdRestoreResponse202DataApproval(str, Enum):
    IMMEDIATE = "immediate"
    REQUIRED = "required"

    def __str__(self) -> str:
        return str(self.value)
