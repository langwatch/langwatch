from enum import Enum


class PostApiGovernanceSecurityLakeSourcesByIdTestBodyConfigSourcesItem(str, Enum):
    CLOUD_TRAIL_MGMT = "CLOUD_TRAIL_MGMT"
    LAMBDA_EXECUTION = "LAMBDA_EXECUTION"
    S3_DATA = "S3_DATA"

    def __str__(self) -> str:
        return str(self.value)
