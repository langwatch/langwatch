from enum import Enum


class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentSource(str, Enum):
    COPILOT_STUDIO = "copilot_studio"
    DATABRICKS = "databricks"
    LANGWATCH = "langwatch"
    TRAFFIC = "traffic"

    def __str__(self) -> str:
        return str(self.value)
