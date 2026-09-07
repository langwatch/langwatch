from enum import Enum


class UpdateOrganizationBodyPrimaryIntentType2Type1(str, Enum):
    AGENT_GOVERNANCE = "AGENT_GOVERNANCE"
    LLM_OPS = "LLM_OPS"

    def __str__(self) -> str:
        return str(self.value)
