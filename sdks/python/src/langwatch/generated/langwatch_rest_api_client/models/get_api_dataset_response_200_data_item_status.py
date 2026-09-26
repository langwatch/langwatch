from enum import Enum


class GetApiDatasetResponse200DataItemStatus(str, Enum):
    FAILED = "failed"
    PROCESSING = "processing"
    READY = "ready"
    UPLOADING = "uploading"

    def __str__(self) -> str:
        return str(self.value)
