from enum import Enum


class GetApiGovernanceRegistryEventsResponse200DataItemAgentSource(str, Enum):
    COPILOT_STUDIO = "copilot_studio"
    DATABRICKS = "databricks"
    LANGWATCH = "langwatch"
    TRAFFIC = "traffic"

    def __str__(self) -> str:
        return str(self.value)
