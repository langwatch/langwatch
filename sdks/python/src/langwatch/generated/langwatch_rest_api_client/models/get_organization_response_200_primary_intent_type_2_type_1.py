from enum import Enum


class GetOrganizationResponse200PrimaryIntentType2Type1(str, Enum):
    AGENT_GOVERNANCE = "AGENT_GOVERNANCE"
    LLM_OPS = "LLM_OPS"

    def __str__(self) -> str:
        return str(self.value)
