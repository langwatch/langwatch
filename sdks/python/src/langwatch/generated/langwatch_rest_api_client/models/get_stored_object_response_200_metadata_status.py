from enum import Enum


class GetStoredObjectResponse200MetadataStatus(str, Enum):
    AVAILABLE = "available"
    DELETED = "deleted"
    FAILED = "failed"
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
