from enum import Enum


class PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataSource(str, Enum):
    COPILOT_STUDIO = "copilot_studio"
    DATABRICKS = "databricks"
    LANGWATCH = "langwatch"
    TRAFFIC = "traffic"

    def __str__(self) -> str:
        return str(self.value)
