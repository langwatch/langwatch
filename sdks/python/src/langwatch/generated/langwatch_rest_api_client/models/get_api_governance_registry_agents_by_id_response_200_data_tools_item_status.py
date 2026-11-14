from enum import Enum


class GetApiGovernanceRegistryAgentsByIdResponse200DataToolsItemStatus(str, Enum):
    ACTIVE = "active"
    DEPRECATED = "deprecated"

    def __str__(self) -> str:
        return str(self.value)
