from enum import Enum


class PostApiGovernanceAgentsByIdStopResponse202DataApproval(str, Enum):
    IMMEDIATE = "immediate"
    REQUIRED = "required"

    def __str__(self) -> str:
        return str(self.value)
