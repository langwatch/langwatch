from enum import Enum


class GetApiGovernanceRegistryAgentsResponse200DataItemToolsItemStatus(str, Enum):
    ACTIVE = "active"
    DEPRECATED = "deprecated"

    def __str__(self) -> str:
        return str(self.value)
