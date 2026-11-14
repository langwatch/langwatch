from enum import Enum


class GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemStatus(str, Enum):
    ACTIVE = "active"
    DEPRECATED = "deprecated"

    def __str__(self) -> str:
        return str(self.value)
