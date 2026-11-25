from enum import Enum


class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentPosture(str, Enum):
    DORMANT = "dormant"
    GOVERNED = "governed"
    SHADOW = "shadow"

    def __str__(self) -> str:
        return str(self.value)
