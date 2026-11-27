from enum import Enum


class GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataToolsItemStatus(str, Enum):
    ACTIVE = "active"
    DEPRECATED = "deprecated"

    def __str__(self) -> str:
        return str(self.value)
