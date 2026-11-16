from enum import Enum


class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemType(str, Enum):
    GOVERNANCE_AGENT_FLAGGED_SHADOW = "governance.agent.flagged_shadow"
    GOVERNANCE_AGENT_QUARANTINED = "governance.agent.quarantined"
    GOVERNANCE_AGENT_REGISTERED = "governance.agent.registered"
    GOVERNANCE_AGENT_REMOVED = "governance.agent.removed"
    GOVERNANCE_AGENT_RESTORED = "governance.agent.restored"
    GOVERNANCE_AGENT_RESTORE_FAILED = "governance.agent.restore_failed"
    GOVERNANCE_AGENT_STOP_FAILED = "governance.agent.stop_failed"
    GOVERNANCE_AGENT_STOP_REQUESTED = "governance.agent.stop_requested"
    GOVERNANCE_AGENT_TOOL_DEPRECATED = "governance.agent.tool_deprecated"
    GOVERNANCE_AGENT_VERSIONED = "governance.agent.versioned"

    def __str__(self) -> str:
        return str(self.value)
