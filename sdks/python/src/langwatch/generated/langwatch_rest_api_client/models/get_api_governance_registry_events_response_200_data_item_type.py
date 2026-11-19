from enum import Enum


class GetApiGovernanceRegistryEventsResponse200DataItemType(str, Enum):
    GOVERNANCE_AGENT_FLAGGED_SHADOW = "governance.agent.flagged_shadow"
    GOVERNANCE_AGENT_REGISTERED = "governance.agent.registered"
    GOVERNANCE_AGENT_REMOVED = "governance.agent.removed"
    GOVERNANCE_AGENT_TOOL_DEPRECATED = "governance.agent.tool_deprecated"
    GOVERNANCE_AGENT_VERSIONED = "governance.agent.versioned"

    def __str__(self) -> str:
        return str(self.value)
