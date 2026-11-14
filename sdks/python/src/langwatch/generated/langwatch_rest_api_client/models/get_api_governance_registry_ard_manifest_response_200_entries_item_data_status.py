from enum import Enum


class GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataStatus(str, Enum):
    ACTIVE = "active"
    REMOVED = "removed"

    def __str__(self) -> str:
        return str(self.value)
