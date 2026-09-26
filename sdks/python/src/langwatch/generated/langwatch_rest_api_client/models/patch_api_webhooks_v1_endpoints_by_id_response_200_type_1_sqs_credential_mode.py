from enum import Enum


class PatchApiWebhooksV1EndpointsByIdResponse200Type1SqsCredentialMode(str, Enum):
    AMBIENT = "ambient"
    ASSUME_ROLE = "assume_role"
    STATIC = "static"

    def __str__(self) -> str:
        return str(self.value)
