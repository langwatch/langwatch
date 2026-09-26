from enum import Enum


class PostApiWebhooksV1EndpointsResponse201Type1SqsCredentialMode(str, Enum):
    AMBIENT = "ambient"
    ASSUME_ROLE = "assume_role"
    STATIC = "static"

    def __str__(self) -> str:
        return str(self.value)
