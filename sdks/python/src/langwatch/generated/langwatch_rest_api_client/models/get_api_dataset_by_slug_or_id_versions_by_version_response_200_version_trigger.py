from enum import Enum


class GetApiDatasetBySlugOrIdVersionsByVersionResponse200VersionTrigger(str, Enum):
    AUTOSAVE = "autosave"
    EXPERIMENT_RUN = "experiment_run"
    INITIAL = "initial"
    MANUAL = "manual"
    RESTORE = "restore"

    def __str__(self) -> str:
        return str(self.value)
