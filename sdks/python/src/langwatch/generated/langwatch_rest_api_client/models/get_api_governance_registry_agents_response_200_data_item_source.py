from enum import Enum


class GetApiGovernanceRegistryAgentsResponse200DataItemSource(str, Enum):
    ARD = "ard"
    AWS = "aws"
    COPILOT_STUDIO = "copilot_studio"
    DATABRICKS = "databricks"
    GCP = "gcp"
    LANGWATCH = "langwatch"
    TRAFFIC = "traffic"

    def __str__(self) -> str:
        return str(self.value)
