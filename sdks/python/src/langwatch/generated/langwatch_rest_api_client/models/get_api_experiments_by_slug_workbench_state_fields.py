from enum import Enum


class GetApiExperimentsBySlugWorkbenchStateFields(str, Enum):
    VERSION = "version"

    def __str__(self) -> str:
        return str(self.value)
