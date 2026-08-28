from enum import Enum


class GetApiWebhooksV1EndpointsResponse200DataItemType1SqsCredentialMode(str, Enum):
    AMBIENT = "ambient"
    ASSUME_ROLE = "assume_role"
    STATIC = "static"

    def __str__(self) -> str:
        return str(self.value)
