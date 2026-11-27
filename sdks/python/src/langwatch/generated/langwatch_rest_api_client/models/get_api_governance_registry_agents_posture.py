from enum import Enum


class GetApiGovernanceRegistryAgentsPosture(str, Enum):
    DORMANT = "dormant"
    GOVERNED = "governed"
    SHADOW = "shadow"

    def __str__(self) -> str:
        return str(self.value)
