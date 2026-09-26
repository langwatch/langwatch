from enum import Enum


class GetApiDatasetResponse200DataItemContentLayout(str, Enum):
    POSTGRES = "postgres"
    S3_JSONL = "s3_jsonl"

    def __str__(self) -> str:
        return str(self.value)
